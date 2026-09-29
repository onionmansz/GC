import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminUrl, createTestDb, type TestDb, type TestUser } from './harness'

describe.skipIf(!adminUrl)('automated balance checks', () => {
  let db: TestDb
  let alice: TestUser // person in household A
  let bot: TestUser // service member of household A
  let mallory: TestUser // other household
  let householdA: string
  let indigo: string
  let esso: string
  let card: string

  const claim = (u: TestUser) => db.as(u, async (c) => (await c.query('select * from public.claim_balance_check()')).rows)
  const request = (u: TestUser, cardId: string) =>
    db.as(u, async (c) => (await c.query('select public.request_balance_check($1) as id', [cardId])).rows[0].id as string)
  const requestRow = async (id: string) => (await db.admin.query('select * from balance_check_requests where id = $1', [id])).rows[0]
  const balance = async (cardId: string) =>
    Number((await db.admin.query('select balance_cents from card_balances where card_id = $1', [cardId])).rows[0].balance_cents)

  beforeAll(async () => {
    db = await createTestDb()
    alice = await db.createUser('alice@example.com')
    bot = await db.createUser('autocheck@example.com')
    mallory = await db.createUser('mallory@example.com')
    householdA = await db.as(alice, async (c) => (await c.query(`select public.create_household('A', 'Alice') as id`)).rows[0].id)
    await db.as(mallory, (c) => c.query(`select public.create_household('M', 'Mallory')`))
    // What supabase/snippets/add_auto_check_member.sql does.
    await db.admin.query(
      `insert into household_members (household_id, user_id, display_name, is_service) values ($1, $2, 'Auto-check', true)`,
      [householdA, bot.id],
    )
    ;[indigo, esso] = await db.as(alice, async (c) => {
      await c.query(`update merchants set auto_check = 'indigo' where name = 'Indigo'`)
      const { rows } = await c.query(`select id, name from merchants order by name`)
      return [rows.find((r) => r.name === 'Indigo').id, rows.find((r) => r.name === 'Esso').id]
    })
    card = await db.as(alice, async (c) => (await c.query(`select public.create_card($1, '6006491234567890', 5000, null, '1234') as id`, [indigo])).rows[0].id)
  })

  afterAll(async () => {
    await db?.close()
  })

  it('member queues a check; the service member claims it with the card details and records the balance', async () => {
    const id = await request(alice, card)
    expect((await requestRow(id)).status).toBe('pending')

    const claimed = await claim(bot)
    expect(claimed).toEqual([
      { request_id: id, card_id: card, provider: 'indigo', card_number: '6006491234567890', pin: '1234', page_url: null },
    ])
    expect((await requestRow(id)).status).toBe('running')

    await db.as(bot, (c) => c.query('select public.complete_balance_check($1, 3210)', [id]))
    const row = await requestRow(id)
    expect(row.status).toBe('done')
    expect(Number(row.result_cents)).toBe(3210)
    expect(await balance(card)).toBe(3210)

    const adj = await db.admin.query(`select amount_cents, note, created_by from transactions where card_id = $1 and type = 'adjust'`, [card])
    expect(adj.rows).toEqual([{ amount_cents: '-1790', note: 'Auto-check', created_by: bot.id }])
  })

  it('tapping twice returns the same active request', async () => {
    const a = await request(alice, card)
    const b = await request(alice, card)
    expect(a).toBe(b)
    await claim(bot)
    await db.as(bot, (c) => c.query(`select public.complete_balance_check($1, null, 'captcha')`, [a]))
    const row = await requestRow(a)
    expect(row.status).toBe('failed')
    expect(row.error_code).toBe('captcha')
    expect(await balance(card)).toBe(3210) // unchanged
  })

  it('returns nothing when the queue is empty', async () => {
    expect(await claim(bot)).toEqual([])
  })

  it('refuses merchants without an automated checker', async () => {
    const other = await db.as(alice, async (c) => (await c.query(`select public.create_card($1, '7000', 100) as id`, [esso])).rows[0].id)
    await expect(request(alice, other)).rejects.toThrow(/not_supported/)
  })

  it('only service members can claim or complete', async () => {
    await request(alice, card)
    await expect(claim(alice)).rejects.toThrow(/not_service_member/)
    await expect(claim(mallory)).rejects.toThrow(/not_service_member/)
    const [job] = await claim(bot)
    await expect(db.as(alice, (c) => c.query('select public.complete_balance_check($1, 1)', [job.request_id]))).rejects.toThrow(/not_found/)
    await db.as(bot, (c) => c.query(`select public.complete_balance_check($1, null, 'test')`, [job.request_id]))
  })

  it('outsiders cannot queue checks or see requests', async () => {
    await expect(request(mallory, card)).rejects.toThrow(/not_found/)
    const rows = await db.as(mallory, (c) => c.query('select * from balance_check_requests'))
    expect(rows.rows).toEqual([])
  })

  it('members cannot write requests directly or promote themselves to service members', async () => {
    await expect(
      db.as(alice, (c) => c.query(`insert into balance_check_requests (household_id, card_id, requested_by) values ($1, $2, $3)`, [householdA, card, alice.id])),
    ).rejects.toThrow(/permission denied/)
    await expect(
      db.as(alice, (c) => c.query(`update household_members set is_service = true where user_id = $1`, [alice.id])),
    ).rejects.toThrow(/permission denied/)
    // Renaming yourself still works.
    const upd = await db.as(alice, (c) => c.query(`update household_members set display_name = 'Al' where user_id = $1`, [alice.id]))
    expect(upd.rowCount).toBe(1)
  })

  it('fails requests left running by a crashed worker', async () => {
    const id = await request(alice, card)
    await claim(bot)
    await db.admin.query(`update balance_check_requests set started_at = now() - interval '6 minutes' where id = $1`, [id])
    expect(await claim(bot)).toEqual([])
    const row = await requestRow(id)
    expect(row.status).toBe('failed')
    expect(row.error_code).toBe('timeout')
  })
  it('assisted checks: the worker hands over with a live-view link, then completes', async () => {
    await db.as(alice, (c) => c.query(`update merchants set auto_check = 'sportchek' where id = $1`, [indigo]))
    const id = await request(alice, card)
    const [job] = await claim(bot)
    expect(job.provider).toBe('sportchek')

    // Only the service member can publish the link.
    await expect(
      db.as(alice, (c) => c.query(`select public.await_user_balance_check($1, 'http://evil.example/')`, [id])),
    ).rejects.toThrow(/not_found/)
    await expect(
      db.as(bot, (c) => c.query(`select public.await_user_balance_check($1, 'javascript:alert(1)')`, [id])),
    ).rejects.toThrow(/check constraint/)
    await db.as(bot, (c) => c.query(`select public.await_user_balance_check($1, 'http://192.168.1.5:8787/v/tok')`, [id]))
    let row = await requestRow(id)
    expect(row.status).toBe('awaiting_user')

    // Members see it; tapping again returns the same request.
    const seen = await db.as(alice, async (c) => (await c.query('select viewer_url from balance_check_requests where id = $1', [id])).rows)
    expect(seen).toEqual([{ viewer_url: 'http://192.168.1.5:8787/v/tok' }])
    expect(await request(alice, card)).toBe(id)
    expect(await claim(bot)).toEqual([])

    await db.as(bot, (c) => c.query('select public.complete_balance_check($1, 2500)', [id]))
    row = await requestRow(id)
    expect(row.status).toBe('done')
    expect(row.viewer_url).toBeNull()
    expect(await balance(card)).toBe(2500)
    await expect(
      db.as(bot, (c) => c.query(`select public.await_user_balance_check($1, 'http://x/')`, [id])),
    ).rejects.toThrow(/not_running/)
  })

  it('fails requests left waiting for a person for 15 minutes', async () => {
    const id = await request(alice, card)
    await claim(bot)
    await db.as(bot, (c) => c.query(`select public.await_user_balance_check($1, 'http://192.168.1.5:8787/v/tok')`, [id]))
    await db.admin.query(`update balance_check_requests set started_at = now() - interval '10 minutes' where id = $1`, [id])
    await claim(bot)
    expect((await requestRow(id)).status).toBe('awaiting_user')
    await db.admin.query(`update balance_check_requests set started_at = now() - interval '16 minutes' where id = $1`, [id])
    await claim(bot)
    const row = await requestRow(id)
    expect(row.status).toBe('failed')
    expect(row.error_code).toBe('timeout')
    expect(row.viewer_url).toBeNull()
  })
  it('a restarted worker releases checks its previous run left in progress', async () => {
    const id = await request(alice, card)
    await claim(bot)
    await db.as(bot, (c) => c.query(`select public.await_user_balance_check($1, 'http://192.168.1.5:8787/v/old')`, [id]))
    await expect(db.as(alice, (c) => c.query('select public.release_balance_checks()'))).rejects.toThrow(/not_service_member/)
    const n = await db.as(bot, async (c) => (await c.query('select public.release_balance_checks() as n')).rows[0].n)
    expect(n).toBe(1)
    const row = await requestRow(id)
    expect(row.status).toBe('failed')
    expect(row.error_code).toBe('interrupted')
    expect(row.viewer_url).toBeNull()
    // "Check now" makes a fresh request.
    expect(await request(alice, card)).not.toBe(id)
    await claim(bot)
    await db.as(bot, (c) => c.query('select public.release_balance_checks()'))
  })
  it('assisted checks on any merchant use its balance page, which must be set', async () => {
    await db.as(alice, (c) => c.query(`update merchants set auto_check = 'assisted', balance_check_url = null where id = $1`, [indigo]))
    await expect(request(alice, card)).rejects.toThrow(/no_balance_page/)
    await db.as(alice, (c) => c.query(`update merchants set balance_check_url = 'https://balance.example/check' where id = $1`, [indigo]))
    const id = await request(alice, card)
    const [job] = await claim(bot)
    expect(job).toMatchObject({ request_id: id, provider: 'assisted', page_url: 'https://balance.example/check' })
    await db.as(bot, (c) => c.query(`select public.complete_balance_check($1, null, 'cancelled')`, [id]))
    await expect(db.as(alice, (c) => c.query(`update merchants set auto_check = 'esso' where id = $1`, [indigo]))).rejects.toThrow(/check constraint/)
  })
})
