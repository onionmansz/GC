import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadStateDir } from './config'
import { INDIGO_BALANCE_PAGE, indigoSessionFile, isLoginUrl, launchBrowser, newIndigoContext, trimPageLoad, waitForFormOrLogin } from './fetchers/indigo'

// Diagnose "site_changed": open Indigo's balance page exactly like a check does (saved
// sign-in, headless, same trimmed loading), time how long the form takes to appear,
// then report what's on screen. Types nothing, so no card data
// is involved. Prints a summary and saves a screenshot next to the saved sign-in.
//
//   docker compose run --rm balance-worker npm run debug-indigo
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
