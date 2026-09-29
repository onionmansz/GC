import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadStateDir } from './config'
import {
  INDIGO_BALANCE_API,
  INDIGO_BALANCE_PAGE,
  indigoSessionFile,
  isLoginUrl,
  launchBrowser,
  newIndigoContext,
  submitBalanceForm,
  trimPageLoad,
  waitForBalanceReply,
  waitForFormOrLogin,
} from './fetchers/indigo'

// Diagnose "site_changed": open Indigo's balance page exactly like a check does (saved
// sign-in, headless, same trimmed loading), time how long the form takes to appear,
// then report what's on screen. Types nothing, so no card data
// is involved. Prints a summary and saves a screenshot next to the saved sign-in.
//
//   docker compose run --rm balance-worker npm run debug-indigo
//   docker compose run --rm balance-worker npm run debug-indigo -- --try-fake-card
//
// --try-fake-card also submits an obviously fake card (0000…/0000) the same way a real
// check does, and reports which requests went out and what Indigo's reply was. Indigo
// simply says the card is unknown; no real card is used.
//
// The summary shows page structure (field labels, frame addresses), not your details.

// Plain JS string: functions compiled by tsx get helpers injected that don't exist in the page.
const SCAN_FIELDS = `(() => {
  const out = []
  function walk(root, inShadow) {
    for (const e of Array.from(root.querySelectorAll('input, textarea, button, [role="button"], [contenteditable="true"]'))) {
      const forLabel = e.id ? root.querySelector('label[for="' + CSS.escape(e.id) + '"]') : null
      const text = forLabel ? forLabel.textContent : e.tagName === 'BUTTON' ? e.textContent : null
      const r = e.getBoundingClientRect()
      out.push({
        tag: e.tagName.toLowerCase(),
        type: e.getAttribute('type'),
        placeholder: e.getAttribute('placeholder'),
        ariaLabel: e.getAttribute('aria-label'),
        name: e.getAttribute('name'),
        label: text ? text.trim().slice(0, 60) : null,
        visible: r.width > 0 && r.height > 0,
        inShadow: inShadow,
      })
    }
    for (const host of Array.from(root.querySelectorAll('*'))) if (host.shadowRoot) walk(host.shadowRoot, true)
  }
  walk(document, false)
  return out
})()`


interface FieldInfo {
  tag: string
  type: string | null
  placeholder: string | null
  ariaLabel: string | null
  name: string | null
  label: string | null
  visible: boolean
  inShadow: boolean
}

async function main() {
  const stateDir = loadStateDir()
  const sessionFile = indigoSessionFile(stateDir)
  if (!existsSync(sessionFile)) {
    console.log('No saved Indigo sign-in. Run: npm run link-indigo')
    return
  }

  const browser = await launchBrowser()
  try {
    const context = await newIndigoContext(browser, sessionFile)
    await trimPageLoad(context) // same as a real check
    const page = await context.newPage()
    const started = Date.now()
    await page.goto(INDIGO_BALANCE_PAGE, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const pageLoadedSeconds = (Date.now() - started) / 1000
    const found = await waitForFormOrLogin(page).then(
      (f) => (f === 'login' ? 'login page' : 'balance form'),
      () => 'nothing (gave up after 90 s)',
    )
    const foundAfterSeconds = (Date.now() - started) / 1000

    const frames = []
    for (const frame of page.frames()) {
      const fields: FieldInfo[] = await frame
        .evaluate<FieldInfo[]>(SCAN_FIELDS)
        .catch(() => [] as FieldInfo[])
      const origin = (() => {
        try {
          const u = new URL(frame.url())
          return `${u.origin}${u.pathname}`
        } catch {
          return frame.url().slice(0, 80)
        }
      })()
      frames.push({ frame: origin, fields })
    }

    let fakeCard: unknown = undefined
    if (process.argv.includes('--try-fake-card') && found === 'balance form') {
      const form = await waitForFormOrLogin(page)
      if (form !== 'login') {
        const requests: string[] = []
        const onRequest = (r: import('playwright').Request) => {
          try {
            const u = new URL(r.url())
            if (u.protocol.startsWith('http')) requests.push(`${r.method()} ${u.host}${u.pathname}`)
          } catch {
            // ignore
          }
        }
        context.on('request', onRequest)
        const failed: string[] = []
        context.on('requestfailed', (r) => {
          if (r.url().startsWith(INDIGO_BALANCE_API)) failed.push(r.failure()?.errorText ?? 'failed')
        })
        const clickedAt = Date.now()
        const reply = waitForBalanceReply(context, 30_000).then(
          async (res) => ({ status: res.status(), body: (await res.text()).slice(0, 200), afterSeconds: (Date.now() - clickedAt) / 1000 }),
          () => null,
        )
        await submitBalanceForm(page, form, '0000000000000000000', '0000')
        const balanceReply = await reply
        await page.waitForTimeout(2000)
        context.off('request', onRequest)
        await page.screenshot({ path: join(stateDir, 'debug-indigo-after.png'), fullPage: true }).catch(() => {})
        fakeCard = {
          balanceReply: balanceReply ?? 'none within 30 s',
          balanceRequestFailed: failed,
          requestsAfterClick: [...new Set(requests)].filter((r) => !r.includes('web-pixels')).slice(0, 40),
          visibleTextAfter: (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400),
          screenshotAfter: join(stateDir, 'debug-indigo-after.png'),
        }
      }
    }

    const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400)
    const shot = join(stateDir, 'debug-indigo.png')
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {})

    const url = new URL(page.url())
    console.log(
      JSON.stringify(
        {
          address: `${url.origin}${url.pathname}`,
          redirectedToLogin: isLoginUrl(page.url()),
          title: await page.title(),
          pageLoadedSeconds,
          found,
          foundAfterSeconds,
          visibleText: bodyText,
          frames,
          screenshot: shot,
          fakeCard,
        },
        null,
        2,
      ),
    )
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'debug failed')
  process.exit(1)
})
