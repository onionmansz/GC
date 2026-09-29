import { describe, expect, it } from 'vitest'
import { CheckError } from '../errors'
import { interpretBalanceJson, interpretBalanceResponse, isLoginUrl } from './indigo'

const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(CheckError)
    return (err as CheckError).code
  }
  throw new Error('expected a CheckError')
}

describe("reading Indigo's balance service reply", () => {
  it('reads the observed success reply', () => {
    expect(interpretBalanceResponse(200, '{"success":true,"balance":39.54,"error":null}')).toBe(3954)
    expect(interpretBalanceResponse(200, '{"success":true,"balance":0,"error":null}')).toBe(0)
    expect(interpretBalanceResponse(200, '{"success":true,"balance":"250.5","error":null}')).toBe(25050)
  })

  it('treats a plain-text 500 (what an unknown card gets) as invalid card', () => {
    expect(codeOf(() => interpretBalanceResponse(500, 'Internal Server Error'))).toBe('invalid_card')
    expect(codeOf(() => interpretBalanceResponse(500, ''))).toBe('invalid_card')
    expect(codeOf(() => interpretBalanceResponse(500, '{"success":false,"error":"Invalid card"}'))).toBe('invalid_card')
  })

  it('asks for a re-link when the sign-in token is refused', () => {
    for (const status of [401, 403, 410]) expect(codeOf(() => interpretBalanceResponse(status, ''))).toBe('relink_needed')
  })

  it('reports throttling and outages as blocked', () => {
    expect(codeOf(() => interpretBalanceResponse(429, ''))).toBe('blocked')
    expect(codeOf(() => interpretBalanceResponse(502, '<html>'))).toBe('blocked')
  })

  it('never guesses: success without a usable balance is site_changed', () => {
    expect(codeOf(() => interpretBalanceResponse(200, '<html>'))).toBe('site_changed')
    expect(codeOf(() => interpretBalanceJson({ success: true, error: null }))).toBe('site_changed')
    expect(codeOf(() => interpretBalanceJson({ success: true, balance: 'N/A' }))).toBe('site_changed')
    expect(codeOf(() => interpretBalanceJson(null))).toBe('site_changed')
  })

  it("follows the page's failure rules", () => {
    expect(codeOf(() => interpretBalanceJson({ success: false, balance: 10 }))).toBe('invalid_card')
    expect(codeOf(() => interpretBalanceJson({ error: 'nope', balance: 10 }))).toBe('invalid_card')
    expect(codeOf(() => interpretBalanceJson({ response_code: '2', balance: 10 }))).toBe('invalid_card')
    expect(interpretBalanceJson({ response_code: '00', current_balance: '5.00' })).toBe(500)
  })
})

describe('isLoginUrl', () => {
  it('spots the Shopify sign-in redirect', () => {
    expect(isLoginUrl('https://account.indigo.ca/authentication/login?client_id=x')).toBe(true)
    expect(isLoginUrl('https://account.indigo.ca/pages/019b9e7d?locale=en')).toBe(false)
    expect(isLoginUrl('not a url')).toBe(false)
  })
})
