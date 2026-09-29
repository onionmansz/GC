import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminUrl, createTestDb, type TestDb, type TestUser } from './harness'

// RLS verified against the real migrations on Postgres, with Supabase's role model.
describe.skipIf(!adminUrl)('row-level security', () => {
  let db: TestDb
  let alice: TestUser // household A
  let bob: TestUser // household A (invited)
  let mallory: TestUser // household M, the outsider
  let cardA: string
  let merchantA: string
  let householdA: string

  beforeAll(async () => {
    db = await createTestDb()
    alice = await db.createUser('alice@example.com')
    bob = await db.createUser('bob@example.com')
    mallory = await db.createUser('mallory@example.com')

    householdA = await db.as(alice, async (c) => {
      const { rows } = await c.query(`select public.create_household('A', 'Alice') as id`)
      return rows[0].id as string
    })
    await db.as(alice, (c) =>
      c.query(`insert into household_invites (household_id, email, display_name) values ($1, 'bob@example.com', 'Bob')`, [householdA]),
    )
    await db.as(bob, (c) => c.query(`select public.accept_household_invite()`))
    await db.as(mallory, (c) => c.query(`select public.create_household('M', 'Mallory')`))

    merchantA = await db.as(alice, async (c) => {
      const { rows } = await c.query(`select id from merchants where name = 'Indigo'`)
      return rows[0].id as string
    })
    cardA = await db.as(alice, async (c) => {
      const { rows } = await c.query(`select public.create_card($1, '6006491234567890', 5000, null, '1234') as id`, [merchantA])
      return rows[0].id as string
    })
    await db.admin.query(
      `insert into storage.objects (bucket_id, name) values ('card-images', $1)`,
      [`${householdA}/barcode.png`],
    )
  })

  afterAll(async () => {
    await db?.close()
  })

  it('lets both household members read the card, ledger and balance', async () => {
    for (const user of [alice, bob]) {
      const cards = await db.as(user, (c) => c.query('select id from cards'))
      expect(cards.rows.map((r) => r.id)).toEqual([cardA])
      const tx = await db.as(user, (c) => c.query('select amount_cents from transactions'))
      expect(tx.rows).toHaveLength(1)
      const bal = await db.as(user, (c) => c.query('select balance_cents from card_balances'))
      expect(Number(bal.rows[0].balance_cents)).toBe(5000)
      const img = await db.as(user, (c) => c.query(`select name from storage.objects where bucket_id = 'card-images'`))
      expect(img.rows).toHaveLength(1)
    }
  })

  it('hides cards, transactions, balances and barcode images from a user outside the household', async () => {
    await db.as(mallory, async (c) => {
      expect((await c.query('select * from cards')).rows).toEqual([])
      expect((await c.query('select * from transactions')).rows).toEqual([])
      expect((await c.query('select * from card_balances')).rows).toEqual([])
      expect((await c.query('select * from household_members where household_id = $1', [householdA])).rows).toEqual([])
      expect((await c.query('select * from households where id = $1', [householdA])).rows).toEqual([])
      expect((await c.query(`select * from storage.objects where bucket_id = 'card-images'`)).rows).toEqual([])
      const merchants = await c.query('select household_id from merchant_summaries')
      expect(merchants.rows.every((r) => r.household_id !== householdA)).toBe(true)
    })
  })

  it('blocks an outsider from writing to another household', async () => {
    await expect(
      db.as(mallory, (c) => c.query(`insert into transactions (card_id, type, amount_cents) values ($1, 'load', 100)`, [cardA])),
    ).rejects.toThrow(/row-level security/)

    await expect(
      db.as(mallory, (c) => c.query(`select public.create_card($1, '999', 100)`, [merchantA])),
    ).rejects.toThrow(/not_found/)

    await expect(
      db.as(mallory, (c) => c.query(`select public.set_card_balance($1, 0)`, [cardA])),
    ).rejects.toThrow(/not_found/)

    const upd = await db.as(mallory, (c) => c.query(`update cards set archived = true where id = $1`, [cardA]))
    expect(upd.rowCount).toBe(0)
    const del = await db.as(mallory, (c) => c.query(`delete from cards where id = $1`, [cardA]))
    expect(del.rowCount).toBe(0)

    await expect(
      db.as(mallory, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('card-images', $1)`, [`${householdA}/evil.png`])),
    ).rejects.toThrow(/row-level security/)
  })

  it('prevents joining a household without an invite', async () => {
    const eve = await db.createUser('eve@example.com')
    await expect(db.as(eve, (c) => c.query(`select public.accept_household_invite()`))).rejects.toThrow(/no_invite/)
    await expect(
      db.as(eve, (c) => c.query(`insert into household_members (household_id, user_id, display_name) values ($1, $2, 'Eve')`, [householdA, eve.id])),
    ).rejects.toThrow(/row-level security/)
  })

  it('denies anonymous access entirely', async () => {
    await expect(db.as(null, (c) => c.query('select * from cards'))).rejects.toThrow(/permission denied/)
    await expect(db.as(null, (c) => c.query('select * from transactions'))).rejects.toThrow(/permission denied/)
    await expect(db.as(null, (c) => c.query(`select public.create_household('x', 'y')`))).rejects.toThrow(/permission denied/)
  })

  it('keeps the ledger append-only, even for members', async () => {
    const upd = await db.as(alice, (c) => c.query(`update transactions set amount_cents = 999999`))
    expect(upd.rowCount).toBe(0)
    const del = await db.as(alice, (c) => c.query(`delete from transactions`))
    expect(del.rowCount).toBe(0)
  })

  it('does not let a member forge created_by or move a card to another household', async () => {
    await expect(
      db.as(alice, (c) => c.query(`insert into transactions (card_id, type, amount_cents, created_by) values ($1, 'load', 100, $2)`, [cardA, bob.id])),
    ).rejects.toThrow(/row-level security/)
    await expect(
      db.as(alice, (c) => c.query(`update cards set created_by = $2 where id = $1`, [cardA, bob.id])),
    ).rejects.toThrow(/immutable_column/)
  })
})
