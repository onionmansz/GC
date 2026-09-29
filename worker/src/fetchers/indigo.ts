import { chmod, mkdir, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Frame, type Locator, type Page, type Request, type Response as PwResponse } from 'playwright'
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

/** The balance form can take a while to appear on a cold, headless load. */
const FORM_TIMEOUT_MS = 90_000

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

/**
 * Headless Chromium identifies itself as "HeadlessChrome", and Indigo's balance service
 * refuses such requests (410 without CORS headers, so the browser reports ERR_FAILED and
 * the page shows "Failed to get gift card balance"). Identify as the regular desktop
 * Chrome it is, same version.
 */
export function desktopUserAgent(browser: Browser): string {
  const major = browser.version().split('.')[0] || '141'
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

export async function newIndigoContext(browser: Browser, sessionFile: string | null): Promise<BrowserContext> {
  return browser.newContext({
    userAgent: desktopUserAgent(browser),
    storageState: sessionFile && existsSync(sessionFile) ? sessionFile : undefined,
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
    viewport: { width: 1280, height: 900 },
  })
}

/** Resource types and hosts a balance check never needs; skipping them speeds up the page. */
const SKIPPED_TYPES = new Set(['image', 'media', 'font'])
const SKIPPED_URL = /\/web-pixels@|google-analytics|googletagmanager|doubleclick|facebook\.net|bat\.bing|monorail-edge|otlp-http/

/** Speed up headless page loads by not fetching images, fonts, video or analytics. */
export async function trimPageLoad(context: BrowserContext): Promise<void> {
  await context.route('**/*', (route) => {
    const req = route.request()
    if (SKIPPED_TYPES.has(req.resourceType()) || SKIPPED_URL.test(req.url())) return route.abort()
    return route.continue()
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
export async function waitForFormOrLogin(page: Page, timeoutMs = FORM_TIMEOUT_MS): Promise<BalanceForm | 'login'> {
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
 * Resolves with Indigo's balance service reply (from any page, frame or worker).
 * Rejects with CheckError('blocked') as soon as the browser reports the request failed
 * (e.g. refused by the service), instead of waiting out the timeout.
 */
export function waitForBalanceReply(context: BrowserContext, timeoutMs = 45_000): Promise<PwResponse> {
  const isBalance = (r: Request) => r.url().startsWith(INDIGO_BALANCE_API) && r.method() === 'POST'
  return new Promise<PwResponse>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      context.off('response', onResponse)
      context.off('requestfailed', onFailed)
    }
    const onResponse = (r: PwResponse) => {
      if (!isBalance(r.request())) return
      cleanup()
      resolve(r)
    }
    const onFailed = (r: Request) => {
      if (!isBalance(r)) return
      cleanup()
      reject(new CheckError('blocked'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new CheckError('site_changed'))
    }, timeoutMs)
    context.on('response', onResponse)
    context.on('requestfailed', onFailed)
  })
}

/**
 * Type like a person and leave each field before clicking. Shopify extension fields
 * commit their value to the extension on change/blur; filling and clicking instantly can
 * submit an empty form, so no request is ever sent.
 */
export async function submitBalanceForm(page: Page, form: BalanceForm, cardNumber: string, pin: string): Promise<void> {
  for (const [field, value] of [
    [form.number, cardNumber.replace(/\s+/g, '')],
    [form.pin, pin],
  ] as const) {
    await field.click()
    await field.fill('')
    await field.pressSequentially(value, { delay: 40 })
    await field.press('Tab')
    await page.waitForTimeout(300)
  }
  await form.submit.click()
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
  async fetch(card, { signal, stateDir, note = () => {} }) {
    if (!card.pin) throw new CheckError('missing_pin')
    const sessionFile = indigoSessionFile(stateDir)
    if (!existsSync(sessionFile)) throw new CheckError('relink_needed')

    const browser = await launchBrowser()
    const abort = () => void browser.close().catch(() => {})
    signal.addEventListener('abort', abort)
    try {
      const context = await newIndigoContext(browser, sessionFile)
      await trimPageLoad(context)
      const page = await context.newPage()
      const started = Date.now()
      const secs = () => `${((Date.now() - started) / 1000).toFixed(1)}s`
      await page.goto(INDIGO_BALANCE_PAGE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      note(`page ${secs()}`)

      const form = await waitForFormOrLogin(page).catch((err) => {
        note(`no form after ${secs()}`)
        throw err
      })
      if (form === 'login') {
        note(`login redirect ${secs()}`)
        throw new CheckError('relink_needed')
      }
      note(`form ${secs()}`)

      const reply = waitForBalanceReply(context)
      await submitBalanceForm(page, form, card.cardNumber, card.pin)
      note(`submitted ${secs()}`)
      const res = await reply.catch((err: unknown) => {
        const code = err instanceof CheckError ? err.code : 'site_changed'
        note(code === 'blocked' ? `balance request refused ${secs()}` : `no balance reply after ${secs()}`)
        throw err instanceof CheckError ? err : new CheckError('site_changed')
      })
      note(`reply ${res.status()} ${secs()}`)
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
