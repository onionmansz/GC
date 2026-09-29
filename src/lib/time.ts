const rtf = new Intl.RelativeTimeFormat('en-CA', { numeric: 'auto' })
const dtf = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' })

/** "just now", "5 minutes ago", "yesterday", … */
export function timeAgo(date: Date | string | number, now: number = Date.now()): string {
  const ms = new Date(date).getTime() - now
  const abs = Math.abs(ms)
  if (abs < 45_000) return 'just now'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86_400_000],
    ['month', 30 * 86_400_000],
    ['week', 7 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(Math.round(ms / size), unit)
  }
  return rtf.format(Math.round(ms / 60_000), 'minute')
}

export function formatDateTime(date: Date | string | number): string {
  return dtf.format(new Date(date))
}
