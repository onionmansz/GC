import { describe, expect, it } from 'vitest'
import { timeAgo } from './time'

describe('timeAgo', () => {
  const now = Date.parse('2026-09-29T12:00:00Z')
  it('formats recent times', () => {
    expect(timeAgo(now - 10_000, now)).toBe('just now')
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 hours ago')
    expect(timeAgo(now - 86_400_000, now)).toBe('yesterday')
  })
})
