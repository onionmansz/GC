// All money is integer cents. These helpers are the only place strings and cents meet.

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })

/** 1234 → "$12.34"; -500 → "-$5.00". */
export function formatCents(cents: number): string {
  assertInteger(cents)
  return cad.format(cents / 100)
}

/** Signed ledger display: 1000 → "+$10.00", -250 → "−$2.50" (true minus sign). */
export function formatSignedCents(cents: number): string {
  assertInteger(cents)
  if (cents === 0) return cad.format(0)
  const abs = cad.format(Math.abs(cents) / 100)
  return cents > 0 ? `+${abs}` : `−${abs}`
}

const MAX_CENTS = 100_000_000 // $1,000,000: far beyond any gift card; guards typos.

/**
 * Parse user input like "12", "12.3", "$1,234.56", " 0.99 " into cents.
 * Returns null for anything that is not a non-negative amount with at most 2 decimals.
 * Parsing is done on the digits, never through floating point.
 */
export function parseMoneyToCents(input: string): number | null {
  const s = input.trim().replace(/^\$/, '').replaceAll(',', '').trim()
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s) ?? /^()\.(\d{1,2})$/.exec(s)
  if (!m) return null
  const dollars = m[1] === '' ? 0 : Number(m[1])
  const frac = (m[2] ?? '').padEnd(2, '0')
  const cents = dollars * 100 + Number(frac)
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null
  return cents
}

/** Cents → value for a money <input>, e.g. 1234 → "12.34". */
export function centsToInput(cents: number): string {
  assertInteger(cents)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function assertInteger(cents: number) {
  if (!Number.isInteger(cents)) throw new TypeError('cents must be an integer')
}
