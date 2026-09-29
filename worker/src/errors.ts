// Failure codes reported back to the app (balance_check_requests.error_code).
// Keep in sync with FAILURES in src/lib/autoCheck.ts. Codes only: never page text,
// which could contain the card number.
export type CheckErrorCode =
  | 'captcha' // the merchant demanded a CAPTCHA
  | 'invalid_card' // the merchant rejected the number/PIN
  | 'site_changed' // the page no longer looks like we expect
  | 'blocked' // rate-limited / bot-blocked / HTTP error
  | 'timeout' // the check took too long
  | 'not_supported' // no fetcher for this provider
  | 'relink_needed' // the saved merchant sign-in expired; re-run the link command
  | 'missing_pin' // the merchant needs the PIN and the card has none
  | 'no_viewer' // an assisted check needs VIEWER_PUBLIC_URL (the live view) configured
  | 'cancelled' // the person cancelled an assisted check in the live view
  | 'interrupted' // the worker restarted mid-check (set by release_balance_checks)
  | 'unknown'

export class CheckError extends Error {
  constructor(readonly code: CheckErrorCode) {
    super(code)
    this.name = 'CheckError'
  }
}

export function errorCodeOf(err: unknown): CheckErrorCode {
  if (err instanceof CheckError) return err.code
  if (err instanceof Error && err.name === 'TimeoutError') return 'timeout'
  return 'unknown'
}
