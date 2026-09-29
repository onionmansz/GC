import type { MerchantSummary } from '../api/types'

/** Home screen: merchants with active cards, grouped by category (A–Z), richest merchant first. */
export function groupByCategory(merchants: readonly MerchantSummary[]) {
  const groups = new Map<string, MerchantSummary[]>()
  for (const m of merchants) {
    if (m.active_card_count === 0) continue
    const list = groups.get(m.category) ?? []
    list.push(m)
    groups.set(m.category, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({
      category,
      merchants: list.sort((a, b) => b.total_balance_cents - a.total_balance_cents || a.name.localeCompare(b.name)),
      totalCents: list.reduce((s, m) => s + m.total_balance_cents, 0),
    }))
}
