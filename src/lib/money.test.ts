import { describe, expect, it } from 'vitest'
import { centsToInput, formatCents, formatSignedCents, parseMoneyToCents } from './money'

describe('formatCents', () => {
  it.each([
    [0, '$0.00'],
    [1, '$0.01'],
    [99, '$0.99'],
    [1234, '$12.34'],
    [100000, '$1,000.00'],
    [-500, '-$5.00'],
  ])('%i → %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected)
  })

  it('rejects non-integer cents', () => {
    expect(() => formatCents(12.5)).toThrow(TypeError)
  })
})

describe('formatSignedCents', () => {
  it('prefixes loads with + and spends with a minus sign', () => {
    expect(formatSignedCents(1000)).toBe('+$10.00')
    expect(formatSignedCents(-250)).toBe('−$2.50')
    expect(formatSignedCents(0)).toBe('$0.00')
  })
})

describe('parseMoneyToCents', () => {
  it.each([
    ['12', 1200],
    ['12.3', 1230],
    ['12.34', 1234],
    ['12.', 1200],
    ['.5', 50],
    ['0.99', 99],
    ['$1,234.56', 123456],
    ['  7.05 ', 705],
    ['0', 0],
  ])('%j → %i', (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected)
  })

  it.each(['', 'abc', '12.345', '-5', '1e3', '12,34.5.6', '$', '.', '10000000.01'])('%j → null', (input) => {
    expect(parseMoneyToCents(input)).toBeNull()
  })

  it('avoids floating point error', () => {
    // 0.29 * 100 === 28.999999999999996 in floating point.
    expect(parseMoneyToCents('0.29')).toBe(29)
    expect(parseMoneyToCents('1.005')).toBeNull()
    expect(parseMoneyToCents('4.35')).toBe(435)
  })
})

describe('centsToInput', () => {
  it('round-trips through parseMoneyToCents', () => {
    for (const cents of [0, 5, 99, 100, 1234, 987654]) {
      expect(parseMoneyToCents(centsToInput(cents))).toBe(cents)
    }
  })
})
