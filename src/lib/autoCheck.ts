// Automated balance checkers the worker (worker/) knows how to run.
// Keep in sync with the merchants.auto_check check constraint and worker/src/fetchers.

export const AUTO_CHECK_PROVIDERS = {
  indigo: 'Indigo (indigo.ca)',
  sportchek: 'Sport Chek (Givex, you tick “I’m not a robot”)',
  assisted: 'Assisted: the balance page above, you tick “I’m not a robot”',
} as const

export type AutoCheckProvider = keyof typeof AUTO_CHECK_PROVIDERS

export function isAutoCheckProvider(value: unknown): value is AutoCheckProvider {
  return typeof value === 'string' && Object.hasOwn(AUTO_CHECK_PROVIDERS, value)
}

export type CheckStatus = 'pending' | 'running' | 'awaiting_user' | 'done' | 'failed'

/** Still in progress (the button stays disabled and the app keeps polling). */
export function isActiveCheck(status: CheckStatus | undefined): boolean {
  return status === 'pending' || status === 'running' || status === 'awaiting_user'
}

/** Friendly text for the worker's error codes (worker/src/errors.ts). */
const FAILURES: Record<string, string> = {
  captcha: 'The merchant asked for a CAPTCHA, so it couldn’t check automatically. Use “Check balance” to check it yourself.',
  invalid_card: 'The merchant didn’t accept this card number or PIN. Check both on the card.',
  missing_pin: 'This merchant needs the card’s PIN. Add it with Edit, then try again.',
  relink_needed:
    'The checker’s sign-in to the merchant has expired. On your server run: docker compose run --rm balance-worker npm run link-indigo',
  site_changed: 'The merchant’s balance page has changed. The checker needs updating.',
  blocked: 'The merchant blocked the automated check. Use “Check balance” to check it yourself.',
  timeout: 'The check took too long. Try again.',
  not_supported: 'Automatic checks aren’t set up for this merchant.',
  no_viewer:
    'This merchant needs you to tick “I’m not a robot”, and the live view isn’t set up. Set VIEWER_PUBLIC_URL in the worker’s .env (see README → Assisted checks).',
  cancelled: 'Check cancelled.',
  interrupted: 'The checker restarted before this check finished. Try again.',
}

export function checkFailureMessage(code: string | null | undefined): string {
  return (code && FAILURES[code]) || 'The automatic check failed. Try again later.'
}

/** A request still pending after this long means the worker probably isn't running. */
export const WORKER_STALE_MS = 45_000

export function isStalePending(status: CheckStatus, createdAt: string, now = Date.now()): boolean {
  return status === 'pending' && now - Date.parse(createdAt) > WORKER_STALE_MS
}
