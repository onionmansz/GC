import { describe, expect, it } from 'vitest'
import { classifyField, findResults, interpretResult } from './givex'

describe('givex page reading', () => {
  it('tells the card number field from the PIN field', () => {
    expect(classifyField('cardnum cardnum  Card Number')).toBe('number')
    expect(classifyField('gc_number   Gift Card Number')).toBe('number')
    expect(classifyField('pin pin  PIN')).toBe('pin')
    expect(classifyField('securitycode   Security Code')).toBe('pin')
    expect(classifyField('email  Email')).toBeNull()
  })

  it('finds balances in the page text', () => {
    expect(findResults('Your Card Balance: $25.00\nThank you').map(interpretResult)).toEqual([{ cents: 2500 }])
    expect(findResults('Current balance\t$1,234.56 CAD').map(interpretResult)).toEqual([{ cents: 123456 }])
    expect(findResults('Balance: CAD 0.00').map(interpretResult)).toEqual([{ cents: 0 }])
    expect(findResults('Balance $7.10').map(interpretResult)).toEqual([{ cents: 710 }])
  })

  it('ignores text without an amount', () => {
    expect(findResults('Check your gift card balance\nEnter your card number')).toEqual([])
    expect(findResults('Balance inquiry for card 6006491234567890')).toEqual([])
  })

  it('recognises invalid-card messages', () => {
    expect(findResults('The card number is invalid. Please try again.').map(interpretResult)).toEqual(['invalid_card'])
    expect(findResults('Card not found').map(interpretResult)).toEqual(['invalid_card'])
  })
})
