import { describe, expect, it } from 'vitest'
import { groupByCategory } from './grouping'
import type { MerchantSummary } from '../api/types'

const m = (name: string, category: string, total: number, count = 1): MerchantSummary => ({
  merchant_id: name,
  household_id: 'h',
  name,
  category,
  color: '#000000',
  balance_check_url: null,
  auto_check: null,
  active_card_count: count,
  total_balance_cents: total,
})

describe('groupByCategory', () => {
  it('groups by category with totals and hides merchants without active cards', () => {
    const groups = groupByCategory([
      m('Esso', 'Gas', 2000),
      m('Tim Hortons', 'Coffee', 500),
      m('Starbucks', 'Coffee', 1500),
      m('Indigo', 'Books', 0, 0),
    ])
    expect(groups.map((g) => [g.category, g.totalCents, g.merchants.map((x) => x.name)])).toEqual([
      ['Coffee', 2000, ['Starbucks', 'Tim Hortons']],
      ['Gas', 2000, ['Esso']],
    ])
  })
})
