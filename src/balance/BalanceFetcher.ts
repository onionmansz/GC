// Extension point for automated balance checks (planned: feat/balance-checker-worker,
// a Node + Playwright worker). v1 ships the interface only, with no implementations,
// so fetchers can be added later without schema changes: a fetched balance is
// recorded through the existing set_card_balance RPC as an 'adjust' transaction,
// and cards.balance_checked_at is stamped.

/** The card fields a fetcher may use. Never log these. */
export interface FetchableCard {
  id: string
  merchantId: string
  cardNumber: string
  pin: string | null
}

export interface BalanceFetcher {
  /** merchants.id this fetcher handles. */
  readonly merchantId: string
  /** Current balance in cents, or null if it could not be determined. */
  fetch(card: FetchableCard): Promise<number | null>
}

export type BalanceFetcherRegistry = ReadonlyMap<string, BalanceFetcher>

/** Empty in v1. */
export const balanceFetchers: BalanceFetcherRegistry = new Map()

export function getBalanceFetcher(
  merchantId: string,
  registry: BalanceFetcherRegistry = balanceFetchers,
): BalanceFetcher | undefined {
  return registry.get(merchantId)
}
