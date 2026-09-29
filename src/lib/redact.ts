// Card numbers and PINs must never reach logs, URLs or error messages.
// redact() is applied to anything we log; the UI never shows raw server error text.

const DIGIT_RUN = /\d(?:[\s-]?\d){3,}/g

/** Mask any run of 4+ digits (optionally separated by spaces or dashes). */
export function redact(text: string): string {
  return text.replace(DIGIT_RUN, '[redacted]')
}

/** "6006491234567890" → "•••• 7890". */
export function maskCardNumber(cardNumber: string): string {
  const digits = cardNumber.replace(/\s+/g, '')
  if (digits.length <= 4) return '••••'
  return `•••• ${digits.slice(-4)}`
}

/** Groups of 4 for readability at the till: "6006 4912 3456 7890". */
export function groupCardNumber(cardNumber: string): string {
  const compact = cardNumber.replace(/\s+/g, '')
  return compact.replace(/(.{4})(?=.)/g, '$1 ')
}

const SAFE_CODE = /^(?:[0-9A-Z]{5}|[A-Za-z_]{1,40})$/ // SQLSTATE, or an identifier like 'TypeError'

/** Log an error without its message or payload (which may echo user input). */
export function logError(context: string, err: unknown): void {
  const raw =
    err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : err instanceof Error
        ? err.name
        : typeof err
  const code = SAFE_CODE.test(raw) ? raw : 'unknown'
  console.error(`[${redact(context)}] ${code}`)
}
