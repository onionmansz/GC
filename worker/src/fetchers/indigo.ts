import { CheckError } from '../errors'
import { parseAmountToCents } from '../money'
import type { BalanceFetcher } from './types'

/**
 * Indigo gift cards are processed by Givex. Indigo's own gift card page
 * (indigo.ca/collections/gift-cards-1, theme asset sdg-app-js.js) checks balances with a
 * single GET to this integration endpoint, sending only the card number (security_code
 * empty). No login, browser or CAPTCHA involved. This mirrors that request exactly.
 */
export const INDIGO_BALANCE_URL = 'https://givex-integration.discolabs.com/api/v1/balance.json'
export const INDIGO_SHOP = 'd87ce2-43.myshopify.com'

interface GivexResponse {
  success?: boolean
  error?: unknown
  errors?: unknown[]
  response_code?: string | number | null
  balance?: string | number | null
  current_balance?: string | number | null
  available_balance?: string | number | null
}

export const indigoFetcher: BalanceFetcher = {
  provider: 'indigo',
  async fetch(card, { fetch, signal }) {
    const number = card.cardNumber.replace(/\s+/g, '')
    if (!/^\d{8,30}$/.test(number)) throw new CheckError('invalid_card')

    const url = new URL(INDIGO_BALANCE_URL)
    url.search = new URLSearchParams({ shop: INDIGO_SHOP, voucher_number: number, security_code: '' }).toString()

    let res: Response
    try {
      res = await fetch(url, {
        signal,
        headers: {
          accept: 'application/json',
          // Same origin the request normally comes from.
          origin: 'https://www.indigo.ca',
          referer: 'https://www.indigo.ca/',
        },
      })
    } catch (err) {
      if (signal.aborted) throw new CheckError('timeout')
      throw err
    }
    if (res.status === 403 || res.status === 429) throw new CheckError('blocked')
    if (res.status === 404 || res.status === 422) throw new CheckError('invalid_card')
    if (!res.ok) throw new CheckError('blocked')

    let body: GivexResponse
    try {
      body = (await res.json()) as GivexResponse
    } catch {
      throw new CheckError('site_changed')
    }
    return interpretGivexResponse(body)
  },
}

/** Same success/failure rules as Indigo's page. */
export function interpretGivexResponse(body: GivexResponse): number {
  const code = body.response_code == null ? '' : String(body.response_code).trim()
  const failed =
    body.success === false || Boolean(body.error) || (Array.isArray(body.errors) && body.errors.length > 0) || (code !== '' && !['0', '00', '000'].includes(code))
  if (failed) throw new CheckError('invalid_card')

  const raw = body.balance ?? body.current_balance ?? body.available_balance
  const cents = raw == null ? null : parseAmountToCents(raw)
  if (cents === null) throw new CheckError('site_changed')
  return cents
}
