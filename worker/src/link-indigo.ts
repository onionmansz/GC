import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { existsSync } from 'node:fs'
import { loadStateDir } from './config'
import {
  INDIGO_BALANCE_PAGE,
  indigoSessionFile,
  isLoginUrl,
  launchBrowser,
  newIndigoContext,
  saveSession,
  waitForFormOrLogin,
} from './fetchers/indigo'

// One-time (and whenever it expires) link of the worker to your Indigo account.
//
//   On the server (Docker):   docker compose run --rm balance-worker npm run link-indigo
//     → asks for your Indigo email, Indigo emails you a code, you type it here.
//   On a PC with a screen:    npm run link-indigo -- --headed
//     → opens a browser window; sign in normally. Then copy state/indigo-session.json
//       to the server (see README).
//
// The saved sign-in (state/indigo-session.json) is like a password for your Indigo
// account: it stays on your machine, readable only by the worker.

const LOGIN_TIMEOUT_MS = 5 * 60_000

async function main() {
  const headed = process.argv.includes('--headed')
  const sessionFile = indigoSessionFile(loadStateDir())
  const browser = await launchBrowser(!headed)
  try {
    const context = await newIndigoContext(browser, existsSync(sessionFile) ? sessionFile : null)
    const page = await context.newPage()
    await page.goto(INDIGO_BALANCE_PAGE, { waitUntil: 'domcontentloaded' })

    if ((await waitForFormOrLogin(page)) !== 'login') {
      await saveSession(context, sessionFile)
      console.log('Already linked: the Indigo balance page opened without signing in.')
      return
    }

    if (headed) {
      console.log('A browser window opened. Sign in to Indigo there (email, then the emailed code).')
      console.log('Waiting until the gift card balance page appears…')
    } else {
      const rl = createInterface({ input, output })
      try {
        const email = (await rl.question('Indigo account email: ')).trim()
        const emailBox = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"], input[autocomplete="username"]').first()
        await emailBox.waitFor({ timeout: 30_000 })
        await emailBox.fill(email)
        await emailBox.press('Enter')

        const codeBox = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name="code"]').first()
        const captcha = page.locator('iframe[src*="captcha"], iframe[title*="captcha" i]').first()
        const next = await Promise.race([
          codeBox.waitFor({ timeout: 30_000 }).then(() => 'code' as const),
          captcha.waitFor({ timeout: 30_000 }).then(() => 'captcha' as const),
        ]).catch(() => 'unknown' as const)
        if (next === 'captcha') {
          throw new Error('Indigo asked for a CAPTCHA. Link from a computer with a screen instead: npm run link-indigo -- --headed (see README).')
        }
        if (next !== 'code') throw new Error("Didn't reach the 'enter code' step. Try again, or link with --headed (see README).")

        const code = (await rl.question('Code from the email Indigo just sent: ')).replace(/\s+/g, '')
        await codeBox.click()
        await page.keyboard.type(code, { delay: 60 })
        await page.keyboard.press('Enter').catch(() => {})
      } finally {
        rl.close()
      }
    }

    await page.waitForURL((url) => !isLoginUrl(url.toString()), { timeout: LOGIN_TIMEOUT_MS })
    if (!page.url().startsWith(INDIGO_BALANCE_PAGE.split('?')[0])) await page.goto(INDIGO_BALANCE_PAGE)
    if ((await waitForFormOrLogin(page)) === 'login') throw new Error('Sign-in did not complete. Please try again.')
    await saveSession(context, sessionFile)
    console.log(`Linked. Saved the Indigo sign-in to ${sessionFile}.`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'Linking failed.')
  process.exit(1)
})
