import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { adminUrl, createTestDb, type TestDb, type TestUser } from './harness'

async function balance(c: pg.Client, cardId: string): Promise<number> {
  const { rows } = await c.query('select balance_cents from card_balances where card_id = $1', [cardId])
  return Number(rows[0].balance_cents)
}

async function archived(c: pg.Client, cardId: string): Promise<boolean> {
  const { rows } = await c.query('select archived from cards where id = $1', [cardId])
  return rows[0].archived as boolean
}

describe.skipIf(!adminUrl)('ledger, RPCs and auto-archive', () => {
  let db: TestDb
  let alice: TestUser
  let merchant: string

  beforeAll(async () => {
    db = await createTestDb()
    alice = await db.createUser('alice@example.com')
    await db.as(alice, (c) => c.query(`select public.create_household('Home', 'Alice')`))
    merchant = await db.as(alice, async (c) => (await c.query(`select id from merchants where name = 'Esso'`)).rows[0].id)
  })

  afterAll(async () => {
    await db?.close()
  })

  async function newCard(number: string, openingCents: number): Promise<string> {
    return db.as(alice, async (c) => (await c.query(`select public.create_card($1, $2, $3) as id`, [merchant, number, openingCents])).rows[0].id)
  }

  it('seeds Indigo, Esso and Tim Hortons with no balance-check URLs', async () => {
    const { rows } = await db.as(alice, (c) => c.query('select name, category, balance_check_url from merchants order by name'))
    expect(rows).toEqual([
      { name: 'Esso', category: 'Gas', balance_check_url: null },
      { name: 'Indigo', category: 'Books', balance_check_url: null },
      { name: 'Tim Hortons', category: 'Coffee', balance_check_url: null },
    ])
  })

  it('refuses to create a second household for the same user', async () => {
    await expect(db.as(alice, (c) => c.query(`select public.create_household('Again', 'Alice')`))).rejects.toThrow(/already_member/)
  })

  it('records the opening balance as a load transaction', async () => {
    const card = await newCard('1001', 2500)
    await db.as(alice, async (c) => {
      const { rows } = await c.query('select type, amount_cents, created_by from transactions where card_id = $1', [card])
      expect(rows).toEqual([{ type: 'load', amount_cents: '2500', created_by: alice.id }])
      expect(await balance(c, card)).toBe(2500)
    })
  })

  it('balance is the sum of load, spend and adjust rows', async () => {
    const card = await newCard('1002', 5000)
    await db.as(alice, async (c) => {
      await c.query(`insert into transactions (card_id, type, amount_cents) values ($1, 'spend', -1234)`, [card])
      await c.query(`insert into transactions (card_id, type, amount_cents) values ($1, 'load', 1000)`, [card])
      expect(await balance(c, card)).toBe(4766)
    })
  })

  it('set_card_balance inserts an adjust row for the difference and stamps balance_checked_at', async () => {
    const card = await newCard('1003', 5000)
    await db.as(alice, async (c) => {
      await c.query(`update cards set balance_checked_at = null where id = $1`, [card])
      const { rows } = await c.query(`select public.set_card_balance($1, 3210, 'Checked online') as delta`, [card])
      expect(Number(rows[0].delta)).toBe(-1790)
      expect(await balance(c, card)).toBe(3210)
      const adj = await c.query(`select amount_cents, note from transactions where card_id = $1 and type = 'adjust'`, [card])
      expect(adj.rows).toEqual([{ amount_cents: '-1790', note: 'Checked online' }])
      const checked = await c.query('select balance_checked_at from cards where id = $1', [card])
      expect(checked.rows[0].balance_checked_at).not.toBeNull()
    })
  })

  it('set_card_balance to the current balance adds no transaction', async () => {
    const card = await newCard('1004', 700)
    await db.as(alice, async (c) => {
      const { rows } = await c.query(`select public.set_card_balance($1, 700) as delta`, [card])
      expect(Number(rows[0].delta)).toBe(0)
      const { rowCount } = await c.query('select 1 from transactions where card_id = $1', [card])
      expect(rowCount).toBe(1)
    })
  })

  it('auto-archives at $0 and unarchives when funds are added', async () => {
    const card = await newCard('1005', 1500)
    await db.as(alice, async (c) => {
      expect(await archived(c, card)).toBe(false)
      await c.query(`insert into transactions (card_id, type, amount_cents) values ($1, 'spend', -1500)`, [card])
      expect(await archived(c, card)).toBe(true)
      await c.query(`insert into transactions (card_id, type, amount_cents) values ($1, 'load', 500)`, [card])
      expect(await archived(c, card)).toBe(false)
      await c.query(`select public.set_card_balance($1, 0)`, [card])
      expect(await archived(c, card)).toBe(true)
    })
  })

  it('a card added at $0 starts archived', async () => {
    const card = await newCard('1006', 0)
    await db.as(alice, async (c) => expect(await archived(c, card)).toBe(true))
  })

  it('rejects a spend larger than the balance without leaking amounts', async () => {
    const card = await newCard('1007', 1000)
    const err = await db
      .as(alice, (c) => c.query(`insert into transactions (card_id, type, amount_cents) values ($1, 'spend', -1001)`, [card]))
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('insufficient_balance')
    await db.as(alice, async (c) => expect(await balance(c, card)).toBe(1000))
  })

  it('enforces amount signs per transaction type', async () => {
    const card = await newCard('1008', 1000)
    for (const [type, amount] of [['load', -1], ['spend', 1], ['adjust', 0]] as const) {
      await expect(
        db.as(alice, (c) => c.query(`insert into transactions (card_id, type, amount_cents) values ($1, $2, $3)`, [card, type, amount])),
      ).rejects.toThrow(/transactions_amount_sign/)
    }
  })

  it('rejects a duplicate card number for the same merchant', async () => {
    await newCard('2000', 100)
    await expect(newCard('2000', 100)).rejects.toThrow(/cards_unique_number/)
  })

  it('merchant_summaries totals only active cards', async () => {
    const { rows } = await db.as(alice, (c) =>
      c.query(`select active_card_count, total_balance_cents from merchant_summaries where merchant_id = $1`, [merchant]),
    )
    const cards = await db.as(alice, (c) =>
      c.query(`select coalesce(sum(b.balance_cents), 0) as total, count(*) as n
                 from cards c join card_balances b on b.card_id = c.id
                where c.merchant_id = $1 and not c.archived`, [merchant]),
    )
    expect(Number(rows[0].active_card_count)).toBe(Number(cards.rows[0].n))
    expect(Number(rows[0].total_balance_cents)).toBe(Number(cards.rows[0].total))
  })
})
