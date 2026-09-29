import { describe, expect, it } from 'vitest'
import { parseBalanceText } from './money'

describe('parseBalanceText', () => {
  it.each([
    ['Your balance is $37.66', 3766],
    ['Balance: $1,234.56', 123456],
    ['CA$ 12.00', 1200],
    ['$0', 0],
    ['Remaining balance $5', 500],
  ])('%j → %i', (text, cents) => {
    expect(parseBalanceText(text)).toBe(cents)
  })

  it('refuses ambiguous or missing amounts', () => {
    expect(parseBalanceText('Card $25.00, balance $10.00')).toBeNull()
    expect(parseBalanceText('No balance found')).toBeNull()
    expect(parseBalanceText('')).toBeNull()
  })
})
