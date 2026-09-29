import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page } from 'playwright'
import { CheckError } from '../errors'
import { parseAmountToCents } from '../money'
import type { BalanceFetcher } from './types'

/**
 * Indigo balance checks go through Indigo's customer account:
 *   account.indigo.ca/pages/<id> (needs a signed-in Indigo account) runs a Shopify
 *   extension that POSTs {"number","pin"} with a 5-minute session token to Indigo's
 *   balance service, which answers {"success":true,"balance":39.54,"error":null}.
 *
 * Rather than re-implement Shopify's sign-in and token refresh, the worker keeps a saved
 * browser sign-in (`npm run link-indigo`), opens the page headlessly, fills in the form
 * like a person would, and reads the service's JSON reply. It never logs or stores the
 * reply beyond the balance.
 */
export const INDIGO_BALANCE_PAGE =
  process.env.INDIGO_BALANCE_PAGE_URL ?? 'https://account.indigo.ca/pages/019b9e7d-e4be-7cc7-9bfa-c78e1c026c2d?locale=en'
export const INDIGO_BALANCE_API = process.env.INDIGO_BALANCE_API_URL ?? 'https://indigo-shopify-prd.fly.dev/api/givex/balance'

const STEP_TIMEOUT_MS = 30_000

export function indigoSessionFile(stateDir: string): string {
  return join(stateDir, 'indigo-session.json')
}

/** True when Shopify has redirected us to sign in (saved sign-in missing or expired). */
export function isLoginUrl(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/authentication/')
  } catch {
    return false
  }
}

export async function launchBrowser(headless = true): Promise<Browser> {
  return chromium.launch({ headless, executablePath: process.env.CHROMIUM_PATH || undefined })
}

export async function newIndigoContext(browser: Browser, sessionFile: string | null): Promise<BrowserContext> {
  return browser.newContext({
    storageState: sessionFile && existsSync(sessionFile) ? sessionFile : undefined,
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
    viewport: { width: 1280, height: 900 },
  })
}

/** Save the (possibly refreshed) sign-in atomically, readable only by the worker. */
export async function saveSession(context: BrowserContext, sessionFile: string): Promise<void> {
  const state = await context.storageState()
  await mkdir(join(sessionFile, '..'), { recursive: true })
  const tmp = `${sessionFile}.tmp`
  await writeFile(tmp, JSON.stringify(state), { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, sessionFile)
}

interface BalanceForm {
  number: Locator
  pin: Locator
  submit: Locator
}

function formIn(frame: Frame | Page): BalanceForm {
  return {
    number: frame.getByPlaceholder(/gift card number/i).or(frame.getByLabel(/gift card number/i)).first(),
    pin: frame.getByPlaceholder(/gift card pin/i).or(frame.getByLabel(/gift card pin/i)).first(),
    submit: frame.getByRole('button', { name: /check balance/i }).first(),
  }
}

/**
 * Wait until either the balance form is on screen (in the page or any frame, since the
 * extension may render in either) or Shopify redirects to sign-in.
 */
export async function waitForFormOrLogin(page: Page, timeoutMs = STEP_TIMEOUT_MS): Promise<BalanceForm | 'login'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (isLoginUrl(page.url())) return 'login'
    for (const frame of page.frames()) {
      const form = formIn(frame)
      if ((await form.number.isVisible().catch(() => false)) && (await form.pin.isVisible().catch(() => false))) return form
    }
    await page.waitForTimeout(500)
  }
  throw new CheckError('site_changed')
}

/**
 * Indigo's balance service reply → cents, using the same rules as its page.
 * Observed: success → 200 {"success":true,"balance":39.54,"error":null};
 * unknown card → 500 with a short plain-text body; no/expired token → 410.
 */
export function interpretBalanceResponse(status: number, text: string): number {
  if (status === 401 || status === 403 || status === 410) throw new CheckError('relink_needed')
  if (status === 429) throw new CheckError('blocked')
  const rejected = status === 400 || status === 404 || status === 422 || status === 500
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    if (rejected) throw new CheckError('invalid_card')
    throw new CheckError(status >= 200 && status < 300 ? 'site_changed' : 'blocked')
  }
  if (status >= 400 && !rejected) throw new CheckError('blocked')
  if (rejected) {
    interpretBalanceJson(body) // throws invalid_card for {"success":false,...}
    throw new CheckError('invalid_card')
  }
  return interpretBalanceJson(body)
}

interface BalanceJson {
  success?: boolean
  error?: unknown
  errors?: unknown[]
  response_code?: string | number | null
  balance?: string | number | null
  current_balance?: string | number | null
  available_balance?: string | number | null
}

export function interpretBalanceJson(raw: unknown): number {
  if (!raw || typeof raw !== 'object') throw new CheckError('site_changed')
  const body = raw as BalanceJson
  const code = body.response_code == null ? '' : String(body.response_code).trim()
  const failed =
    body.success === false ||
    Boolean(body.error) ||
    (Array.isArray(body.errors) && body.errors.length > 0) ||
    (code !== '' && !['0', '00', '000'].includes(code))
  if (failed) throw new CheckError('invalid_card')

  const value = body.balance ?? body.current_balance ?? body.available_balance
  const cents = value == null ? null : parseAmountToCents(value)
  if (cents === null) throw new CheckError('site_changed')
  return cents
}

export const indigoFetcher: BalanceFetcher = {
  provider: 'indigo',
  async fetch(card, { signal, stateDir }) {
    if (!card.pin) throw new CheckError('missing_pin')
    const sessionFile = indigoSessionFile(stateDir)
    if (!existsSync(sessionFile)) throw new CheckError('relink_needed')

    const browser = await launchBrowser()
    const abort = () => void browser.close().catch(() => {})
    signal.addEventListener('abort', abort)
    try {
      const context = await newIndigoContext(browser, sessionFile)
      const page = await context.newPage()
      await page.goto(INDIGO_BALANCE_PAGE, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS })

      const form = await waitForFormOrLogin(page)
      if (form === 'login') throw new CheckError('relink_needed')

      const reply = context.waitForEvent('response', {
        predicate: (r) => r.url().startsWith(INDIGO_BALANCE_API) && r.request().method() === 'POST',
        timeout: STEP_TIMEOUT_MS,
      })
      await form.number.fill(card.cardNumber.replace(/\s+/g, ''))
      await form.pin.fill(card.pin)
      await form.submit.click()
      const res = await reply.catch(() => {
        throw new CheckError('site_changed')
      })
      const cents = interpretBalanceResponse(res.status(), await res.text())

      // Keep Shopify's refreshed sign-in for next time.
      await saveSession(context, sessionFile)
      return cents
    } catch (err) {
      if (signal.aborted) throw new CheckError('timeout')
      throw err
    } finally {
      signal.removeEventListener('abort', abort)
      await browser.close().catch(() => {})
    }
  },
}
