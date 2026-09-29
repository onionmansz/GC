/** The card fields a fetcher may use. Never log these. */
export interface FetchableCard {
  cardNumber: string
  pin: string | null
}

export interface FetchContext {
  /** Aborts when the check exceeds its time limit. */
  signal: AbortSignal
  /** Directory for per-merchant saved sign-ins (worker/state, a Docker volume). */
  stateDir: string
  /** Progress notes for the worker log (timings, step names). Never pass card data. */
  note?: (message: string) => void
}

/**
 * Looks up a card's balance with the merchant.
 * Resolve with cents, or throw a CheckError with a code the app can explain.
 */
export interface BalanceFetcher {
  /** Matches merchants.auto_check. */
  readonly provider: string
  fetch(card: FetchableCard, ctx: FetchContext): Promise<number>
}
