import { describe, expect, it } from 'vitest'
import { parseAmountToCents } from './money'

describe('parseAmountToCents', () => {
  it.each([
    ['12.34', 1234],
    ['12.3', 1230],
    ['12', 1200],
    ['0.00', 0],
    ['1,234.50', 123450],
    ['12.3400', 1234],
    [37.66, 3766],
    [0.29, 29],
    [25, 2500],
  ] as const)('%j → %i', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents)
  })

  it.each(['-5.00', 'abc', '', 'NaN', '12.345'])('%j → null', (input) => {
    expect(parseAmountToCents(input)).toBeNull()
  })
})
