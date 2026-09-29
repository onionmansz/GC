// Automated balance checkers the worker (worker/) knows how to run.
// Keep in sync with the merchants.auto_check check constraint and worker/src/fetchers.

export const AUTO_CHECK_PROVIDERS = {
  indigo: 'Indigo (indigo.ca)',
} as const

export type AutoCheckProvider = keyof typeof AUTO_CHECK_PROVIDERS

export function isAutoCheckProvider(value: unknown): value is AutoCheckProvider {
  return typeof value === 'string' && Object.hasOwn(AUTO_CHECK_PROVIDERS, value)
}

export type CheckStatus = 'pending' | 'running' | 'done' | 'failed'

/** Friendly text for the worker's error codes (worker/src/errors.ts). */
const FAILURES: Record<string, string> = {
  captcha: 'The merchant asked for a CAPTCHA, so it couldn’t check automatically. Use “Check balance” to check it yourself.',
  invalid_card: 'The merchant didn’t accept this card number or PIN. Check both on the card.',
  missing_pin: 'This merchant needs the card’s PIN. Add it with Edit, then try again.',
  relink_needed:
    'The checker’s sign-in to the merchant has expired. On your server run: docker compose run --rm balance-worker npm run link-indigo',
  site_changed: 'The merchant’s balance page has changed. The checker needs updating.',
  blocked: 'The merchant blocked the automated check. Try again later.',
  timeout: 'The check took too long. Try again.',
  not_supported: 'Automatic checks aren’t set up for this merchant.',
}

export function checkFailureMessage(code: string | null | undefined): string {
  return (code && FAILURES[code]) || 'The automatic check failed. Try again later.'
}

/** A request still pending after this long means the worker probably isn't running. */
export const WORKER_STALE_MS = 45_000

export function isStalePending(status: CheckStatus, createdAt: string, now = Date.now()): boolean {
  return status === 'pending' && now - Date.parse(createdAt) > WORKER_STALE_MS
}
