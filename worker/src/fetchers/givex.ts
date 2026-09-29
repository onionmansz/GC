import { chromium, type Browser, type Frame, type Page } from 'playwright'
import { CheckError } from '../errors'
import { parseAmountToCents } from '../money'
import { desktopUserAgent } from './indigo'
import type { BalanceFetcher, FetchableCard } from './types'

/**
 * Assisted checks on Givex balance pages (Sport Chek and others).
 *
 * The page asks for an "I'm not a robot" check, which a person has to do. The worker
 * opens the page, fills in the card, then hands the live page to a person (see
 * viewer.ts) and watches for the balance to appear. It doesn't touch the robot check.
 */
export const SPORTCHEK_BALANCE_PAGE =
  process.env.SPORTCHEK_BALANCE_PAGE_URL ?? 'https://wwws-canada2.givex.com/merchant_balcheck/3281_en/'

/** A phone-shaped window, so the live view is readable on a phone. */
const VIEWPORT = { width: 480, height: 860 }

/**
 * Headed when a display exists (the Docker image runs under a virtual display), which
 * is an ordinary Chrome window. Headless otherwise (development, tests).
 */
export async function launchAssistBrowser(): Promise<Browser> {
  return chromium.launch({ headless: !process.env.DISPLAY, executablePath: process.env.CHROMIUM_PATH || undefined })
}

type FieldKind = 'number' | 'pin'

/** Which card field an input is, from its name/id/placeholder/label text. */
export function classifyField(description: string): FieldKind | null {
  const d = description.toLowerCase()
  if (/pin|security|cvv|cvc|access/.test(d)) return 'pin'
  if (/card|number|cert|gift/.test(d)) return 'number'
  return null
}

/** Best effort: fill the card number (and PIN) wherever the form is. True if the number went in. */
export async function prefillCard(page: Page, card: FetchableCard): Promise<boolean> {
  let filledNumber = false
  for (const frame of page.frames()) {
    if (isCaptchaFrame(frame)) continue
    const inputs = frame.locator('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button])')
    const count = await inputs.count().catch(() => 0)
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i)
      if (!(await input.isVisible().catch(() => false))) continue
      const description = await input
        .evaluate((el: HTMLInputElement) =>
          [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), ...Array.from(el.labels ?? []).map((l) => l.textContent)].join(' '),
        )
        .catch(() => '')
      const kind = classifyField(description)
      const value = kind === 'number' ? card.cardNumber.replace(/\s+/g, '') : kind === 'pin' ? card.pin : null
      if (!value) continue
      await input.fill(value).catch(() => {})
      if (kind === 'number') filledNumber = true
    }
  }
  return filledNumber
}

/** A frame (e.g. the balance form) that Chrome couldn't load: its error page instead. */
export function hasRefusedFrame(page: Page): boolean {
  return page.frames().some((f) => f.url().startsWith('chrome-error://'))
}

function isCaptchaFrame(frame: Frame): boolean {
  return /recaptcha|hcaptcha|challenges\.cloudflare/.test(frame.url())
}

export type GivexReading = { cents: number } | 'invalid_card'

const BALANCE = /balance[^$\d\n]{0,40}(?:CAD|C\$|\$)?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\b/gi
const INVALID = /\b(invalid|incorrect|not (?:valid|found|recogni[sz]ed))\b[^\n]{0,60}/gi

/** Every balance / invalid-card message in a page's text. */
export function findResults(text: string): string[] {
  return [...text.matchAll(BALANCE), ...text.matchAll(INVALID)].map((m) => m[0].replace(/\s+/g, ' ').trim())
}

/** The result a message stands for. */
export function interpretResult(message: string): GivexReading | null {
  const m = new RegExp(BALANCE.source, 'i').exec(message)
  if (m) {
    const cents = parseAmountToCents(`${m[1]}.${m[2]}`)
    return cents === null ? null : { cents }
  }
  return new RegExp(INVALID.source, 'i').test(message) ? 'invalid_card' : null
}

async function pageMessages(page: Page): Promise<string[]> {
  const out: string[] = []
  for (const frame of page.frames()) {
    if (isCaptchaFrame(frame)) continue
    const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    out.push(...findResults(text))
  }
  return out
}

/**
 * Waits for a balance (or an invalid-card message) that wasn't on the page when the
 * person took over, so static text like "Check your balance" never counts.
 */
export async function waitForResult(page: Page, signal: AbortSignal, baseline: Set<string>): Promise<number> {
  while (!signal.aborted) {
    if (page.isClosed()) throw new CheckError('cancelled')
    const fresh = (await pageMessages(page)).filter((m) => !baseline.has(m))
    for (const message of fresh) {
      const reading = interpretResult(message)
      if (reading === 'invalid_card') throw new CheckError('invalid_card')
      if (reading) return reading.cents
    }
    await new Promise((r) => setTimeout(r, 750))
  }
  throw new CheckError('timeout')
}

export function givexFetcher(provider: string, pageUrl: () => string): BalanceFetcher {
  return {
    provider,
    assisted: true,
    async fetch(card, ctx) {
      if (!ctx.handOver) throw new CheckError('no_viewer')
      const browser = await launchAssistBrowser()
      try {
        const context = await browser.newContext({
          viewport: VIEWPORT,
          locale: 'en-CA',
          timezoneId: 'America/Toronto',
          // Headless Chrome announces itself; a headed run keeps Chrome's own identity.
          userAgent: process.env.DISPLAY ? undefined : desktopUserAgent(browser),
        })
        const page = await context.newPage()
        const started = Date.now()
        const res = await page.goto(pageUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null)
        if (!res) throw new CheckError('blocked')
        if (res.status() >= 400) throw new CheckError('blocked')
        await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => {})
        // The merchant's bot protection sometimes refuses the balance form (inside a frame)
        // to an automated browser. Say so now rather than hand over a dead page.
        if (hasRefusedFrame(page)) throw new CheckError('blocked')
        const filled = await prefillCard(page, card)
        ctx.note?.(`page ${((Date.now() - started) / 1000).toFixed(1)}s, ${filled ? 'card filled' : 'form not found'}`)
        const baseline = new Set(await pageMessages(page))
        await ctx.handOver(page)
        return await waitForResult(page, ctx.signal, baseline)
      } finally {
        await browser.close().catch(() => {})
      }
    },
  }
}

export const sportchekFetcher = givexFetcher('sportchek', () => SPORTCHEK_BALANCE_PAGE)
