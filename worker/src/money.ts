/**
 * Parse a balance shown on a merchant page ("$1,234.56", "CA$ 12.00", "$0") into cents.
 * Returns null unless the text contains exactly one dollar amount, so an ambiguous page
 * never records a wrong balance.
 */
export function parseBalanceText(text: string): number | null {
  const matches = [...text.matchAll(/(?:CA)?\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?(?!\d)/g)]
  if (matches.length !== 1) return null
  const [, dollars, cents = '00'] = matches[0]
  const value = Number(dollars.replaceAll(',', '')) * 100 + Number(cents)
  return Number.isSafeInteger(value) ? value : null
}
