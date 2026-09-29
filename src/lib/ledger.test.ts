import { describe, expect, it } from 'vitest'
import {
  adjustDelta,
  archivedAfterTransaction,
  balanceOf,
  checkLoad,
  checkSpend,
  signedAmount,
  sortByLowestBalance,
} from './ledger'

describe('balanceOf', () => {
  it('is 0 for an empty ledger', () => {
    expect(balanceOf([])).toBe(0)
  })

  it('sums loads, spends and adjustments', () => {
    expect(balanceOf([{ amount_cents: 5000 }, { amount_cents: -1234 }, { amount_cents: 1000 }, { amount_cents: -266 }])).toBe(4500)
  })
})

describe('adjustDelta', () => {
  it('is negative when the real balance is lower', () => {
    expect(adjustDelta(5000, 3210)).toBe(-1790)
  })
  it('is positive when the real balance is higher', () => {
    expect(adjustDelta(1000, 2500)).toBe(1500)
  })
  it('is 0 when unchanged', () => {
    expect(adjustDelta(700, 700)).toBe(0)
  })
  it('applying the delta always lands on the target', () => {
    for (const [cur, target] of [[0, 0], [0, 999], [12345, 1], [50, 0]]) {
      expect(balanceOf([{ amount_cents: cur }, { amount_cents: adjustDelta(cur, target) }])).toBe(target)
    }
  })
})

describe('signedAmount', () => {
  it('stores spends as negative and loads as positive', () => {
    expect(signedAmount('spend', 500)).toBe(-500)
    expect(signedAmount('load', 500)).toBe(500)
    expect(signedAmount('spend', -500)).toBe(-500)
  })
})

describe('archivedAfterTransaction (auto-archive rule)', () => {
  it('archives at exactly $0', () => {
    expect(archivedAfterTransaction(0)).toBe(true)
  })
  it('keeps (or restores) cards with money on them', () => {
    expect(archivedAfterTransaction(1)).toBe(false)
    expect(archivedAfterTransaction(5000)).toBe(false)
  })
})

describe('checkSpend / checkLoad', () => {
  it('rejects empty, zero and negative amounts', () => {
    expect(checkSpend(1000, null)).toEqual({ ok: false, reason: 'not_positive' })
    expect(checkSpend(1000, 0)).toEqual({ ok: false, reason: 'not_positive' })
    expect(checkLoad(0)).toEqual({ ok: false, reason: 'not_positive' })
  })
  it('rejects spending more than the balance', () => {
    expect(checkSpend(1000, 1001)).toEqual({ ok: false, reason: 'exceeds_balance' })
  })
  it('allows spending the whole balance', () => {
    expect(checkSpend(1000, 1000)).toEqual({ ok: true })
  })
})

describe('sortByLowestBalance', () => {
  it('orders by balance ascending, oldest first on ties', () => {
    const cards = [
      { id: 'a', balance_cents: 500, created_at: '2026-01-02' },
      { id: 'b', balance_cents: 100, created_at: '2026-01-03' },
      { id: 'c', balance_cents: 500, created_at: '2026-01-01' },
    ]
    expect(sortByLowestBalance(cards).map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })
})
