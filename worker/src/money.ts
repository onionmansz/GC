/**
 * A plain amount from an API ("12.34", "12.3", 12.34, "1,234.00") → cents, parsed on
 * the digits (no floating point). Null if it isn't a non-negative amount.
 */
export function parseAmountToCents(value: string | number): number | null {
  const s = (typeof value === 'number' ? value.toFixed(2) : value).trim().replace(/^\$/, '').replaceAll(',', '')
  const m = /^(\d+)(?:\.(\d{1,2})0*)?$/.exec(s)
  if (!m) return null
  const [, dollars, frac = ''] = m
  const cents = Number(dollars) * 100 + Number(frac.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}
