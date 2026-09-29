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

/**
 * A short, safe identifier for an error: a SQLSTATE / API code, an HTTP status, or the
 * error's class name. Never the message or payload, which may echo user input.
 */
export function safeErrorCode(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; status?: unknown; statusCode?: unknown }
  const candidates = [e.code, e.statusCode, e.status, err instanceof Error ? err.name : typeof err]
  for (const c of candidates) {
    const s = typeof c === 'number' ? String(c) : c
    if (typeof s === 'string' && (SAFE_CODE.test(s) || /^\d{3}$/.test(s))) return s
  }
  return 'unknown'
}

/** Log an error without its message or payload (which may echo user input). */
export function logError(context: string, err: unknown): void {
  console.error(`[${redact(context)}] ${safeErrorCode(err)}`)
}
