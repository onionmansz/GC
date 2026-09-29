import { describe, expect, it, vi } from 'vitest'
import { CheckError } from '../errors'
import { INDIGO_BALANCE_URL, INDIGO_SHOP, indigoFetcher, interpretGivexResponse } from './indigo'

const card = { cardNumber: '6006 4912 3456 7890', pin: '1234' }

function stubFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
}

async function run(fetch: ReturnType<typeof stubFetch>) {
  return indigoFetcher.fetch(card, { fetch: fetch as unknown as typeof globalThis.fetch, signal: new AbortController().signal })
}

async function code(p: Promise<unknown>) {
  const err = await p.catch((e: unknown) => e)
  expect(err).toBeInstanceOf(CheckError)
  return (err as CheckError).code
}

describe('indigo fetcher', () => {
  it('sends the same request as indigo.ca: shop + card number, no PIN', async () => {
    const fetch = stubFetch(200, { success: true, response_code: '0', balance: '37.66' })
    expect(await run(fetch)).toBe(3766)
    const [url] = fetch.mock.calls[0] as unknown as [URL]
    expect(`${url.origin}${url.pathname}`).toBe(INDIGO_BALANCE_URL)
    expect(Object.fromEntries(url.searchParams)).toEqual({ shop: INDIGO_SHOP, voucher_number: '6006491234567890', security_code: '' })
  })

  it('reads the balance from any of the fields the page accepts', () => {
    expect(interpretGivexResponse({ balance: 12 })).toBe(1200)
    expect(interpretGivexResponse({ current_balance: '0.00', response_code: '00' })).toBe(0)
    expect(interpretGivexResponse({ available_balance: '250.5' })).toBe(25050)
  })

  it('treats rejections as invalid card', () => {
    expect(() => interpretGivexResponse({ response_code: '2', balance: '0' })).toThrowError(new CheckError('invalid_card'))
    expect(() => interpretGivexResponse({ success: false })).toThrowError(new CheckError('invalid_card'))
    expect(() => interpretGivexResponse({ errors: ['Invalid voucher'] })).toThrowError(new CheckError('invalid_card'))
  })

  it('never guesses when the balance is missing or odd', () => {
    expect(() => interpretGivexResponse({ success: true })).toThrowError(new CheckError('site_changed'))
    expect(() => interpretGivexResponse({ balance: 'N/A' })).toThrowError(new CheckError('site_changed'))
  })

  it('maps HTTP failures', async () => {
    expect(await code(run(stubFetch(429, '')))).toBe('blocked')
    expect(await code(run(stubFetch(403, '')))).toBe('blocked')
    expect(await code(run(stubFetch(500, '')))).toBe('blocked')
    expect(await code(run(stubFetch(404, '')))).toBe('invalid_card')
    expect(await code(run(stubFetch(200, '<html>not json</html>')))).toBe('site_changed')
  })

  it('rejects card numbers that are not digits before calling out', async () => {
    const fetch = stubFetch(200, {})
    const p = indigoFetcher.fetch({ cardNumber: 'abc', pin: null }, { fetch: fetch as unknown as typeof globalThis.fetch, signal: new AbortController().signal })
    expect(await code(p)).toBe('invalid_card')
    expect(fetch).not.toHaveBeenCalled()
  })
})
