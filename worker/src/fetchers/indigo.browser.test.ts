import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { AddressInfo } from 'node:net'
import type { BalanceFetcher } from './types'

// Drives the real Indigo fetcher (headless Chromium) against a local imitation of
// Indigo's balance page: sign-in redirect, form inside a web component's shadow DOM,
// request made from a dedicated worker (like Shopify extensions), JSON/500 replies.

const GOOD = { number: '6006491234567890', pin: '1234' }

const PAGE = `<!doctype html><html><body>
<h1>Check gift card balance | Indigo</h1>
<gc-balance></gc-balance>
<script>
const worker = new Worker(URL.createObjectURL(new Blob([\`
  onmessage = async (e) => {
    const r = await fetch(location.origin + '/api/givex/balance', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test' }, body: JSON.stringify(e.data) })
    postMessage(await r.text())
  }\`], { type: 'text/javascript' })))
customElements.define('gc-balance', class extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = '<input placeholder="Gift Card Number"><input placeholder="Gift Card PIN"><button>Check Balance</button><p id=out></p>'
    const [num, pin] = root.querySelectorAll('input')
    // Like Shopify extension fields: values are committed on change (leaving the field),
    // not while typing. An empty field sends no request at all.
    const committed = { number: '', pin: '' }
    num.addEventListener('change', () => { committed.number = num.value })
    pin.addEventListener('change', () => { committed.pin = pin.value })
    worker.onmessage = (e) => { root.getElementById('out').textContent = e.data }
    root.querySelector('button').onclick = () => {
      if (!committed.number || !committed.pin) return
      worker.postMessage({ ...committed })
    }
  }
})
</script></body></html>`

function startFixture(): Promise<Server> {
  const server = createServer((req, res) => {
    const signedIn = (req.headers.cookie ?? '').includes('session=ok')
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/pages/balance') {
      if (!signedIn) {
        res.writeHead(302, { location: '/authentication/login?client_id=test' }).end()
        return
      }
      // Shopify refreshes the sign-in as you browse.
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'refreshed=yes; Path=/; Max-Age=3600' }).end(PAGE)
      return
    }
    if (url.pathname.startsWith('/authentication/')) {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<input type=email placeholder=Email>')
      return
    }
    if (url.pathname === '/api/givex/balance' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const { number, pin } = JSON.parse(body)
        if (number === GOOD.number && pin === GOOD.pin) {
          res.writeHead(200, { 'content-type': 'application/json' }).end('{"success":true,"balance":39.54,"error":null}')
        } else {
          res.writeHead(500, { 'content-type': 'text/plain' }).end('Internal Server Error')
        }
      })
      return
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function browserAvailable(): Promise<boolean> {
  try {
    const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
    await b.close()
    return true
  } catch {
    return false
  }
}

const canRun = await browserAvailable()

describe.skipIf(!canRun)('indigo fetcher in a real browser (local imitation of the page)', () => {
  let server: Server
  let stateDir: string
  let fetcher: BalanceFetcher
  let sessionFile: string

  beforeAll(async () => {
    server = await startFixture()
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    process.env.INDIGO_BALANCE_PAGE_URL = `${base}/pages/balance`
    process.env.INDIGO_BALANCE_API_URL = `${base}/api/givex/balance`
    const mod = await import('./indigo')
    fetcher = mod.indigoFetcher
    stateDir = await mkdtemp(join(tmpdir(), 'indigo-state-'))
    sessionFile = mod.indigoSessionFile(stateDir)
    await writeFile(
      sessionFile,
      JSON.stringify({ cookies: [{ name: 'session', value: 'ok', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] }),
    )
  }, 60_000)

  afterAll(async () => {
    server?.close()
    if (stateDir) await rm(stateDir, { recursive: true, force: true })
  })

  const run = (card: { cardNumber: string; pin: string | null }, dir = stateDir) =>
    fetcher.fetch(card, { signal: new AbortController().signal, stateDir: dir })

  it('fills the form, reads the balance reply and keeps the refreshed sign-in', async () => {
    expect(await run({ cardNumber: '6006 4912 3456 7890', pin: GOOD.pin })).toBe(3954)
    const saved = JSON.parse(await readFile(sessionFile, 'utf8'))
    expect(saved.cookies.map((c: { name: string }) => c.name).sort()).toEqual(['refreshed', 'session'])
  }, 60_000)

  it('reports an unknown card as invalid_card', async () => {
    await expect(run({ cardNumber: '0000000000000000000', pin: '0000' })).rejects.toMatchObject({ code: 'invalid_card' })
  }, 60_000)

  it('asks for a re-link when the saved sign-in no longer works', async () => {
    const expired = await mkdtemp(join(tmpdir(), 'indigo-expired-'))
    await writeFile(join(expired, 'indigo-session.json'), JSON.stringify({ cookies: [], origins: [] }))
    await expect(run({ cardNumber: GOOD.number, pin: GOOD.pin }, expired)).rejects.toMatchObject({ code: 'relink_needed' })
    await rm(expired, { recursive: true, force: true })
  }, 60_000)

  it('asks for a link when there is no saved sign-in, without opening a browser', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'indigo-empty-'))
    await expect(run({ cardNumber: GOOD.number, pin: GOOD.pin }, empty)).rejects.toMatchObject({ code: 'relink_needed' })
    await rm(empty, { recursive: true, force: true })
  })

  it('needs the PIN', async () => {
    await expect(run({ cardNumber: GOOD.number, pin: null })).rejects.toMatchObject({ code: 'missing_pin' })
  })
})
