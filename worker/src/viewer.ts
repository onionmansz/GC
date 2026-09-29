import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { CDPSession, Page } from 'playwright'
import type { FetchableCard } from './fetchers/types'

/**
 * Live view for assisted checks. While a check waits for a person, this serves one
 * page at <VIEWER_PUBLIC_URL>/v/<one-time token>: a picture of the worker's browser,
 * updated live, where taps and drags become clicks and scrolls in that browser. The
 * person ticks "I'm not a robot" (and any picture puzzle) themselves.
 *
 * The card number and PIN never go to the viewer page: its "Type card number/PIN"
 * buttons ask the worker to type them. The pictures do show the filled-in form, so
 * the link only works for the current check and only on the home network (or a
 * private network like Tailscale); don't forward this port to the internet.
 */

interface Session {
  token: Buffer
  page: Page
  card: FetchableCard
  cdp: CDPSession
  clients: Set<ServerResponse>
  last: string | null
  width: number
  height: number
}

const MAX_BODY = 4096
const KEYS = new Set(['Backspace', 'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export class Viewer {
  private server: Server | null = null
  private session: Session | null = null

  constructor(
    private readonly publicUrl: string,
    private readonly port: number,
  ) {}

  async start(): Promise<number> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    await new Promise<void>((resolve) => this.server!.listen(this.port, '0.0.0.0', resolve))
    return (this.server.address() as AddressInfo).port
  }

  async stop(): Promise<void> {
    await this.close()
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
  }

  /** Start showing `page`; returns the one-time link for the app. */
  async open(page: Page, card: FetchableCard): Promise<string> {
    await this.close()
    const token = randomBytes(24)
    const viewport = page.viewportSize() ?? { width: 500, height: 900 }
    const cdp = await page.context().newCDPSession(page)
    const session: Session = { token, page, card, cdp, clients: new Set(), last: null, ...viewport }
    cdp.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
      session.last = data
      if (metadata.deviceWidth && metadata.deviceHeight) {
        session.width = metadata.deviceWidth
        session.height = metadata.deviceHeight
      }
      for (const client of session.clients) send(client, 'frame', { w: session.width, h: session.height, img: data })
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: viewport.width * 2, maxHeight: viewport.height * 2 })
    this.session = session
    return `${this.publicUrl}/v/${token.toString('base64url')}`
  }

  /** End the current live view; open viewers are told the check is over. */
  async close(outcome: 'done' | 'failed' = 'done'): Promise<void> {
    const s = this.session
    if (!s) return
    this.session = null
    for (const client of s.clients) {
      send(client, 'end', { outcome })
      client.end()
    }
    await s.cdp.send('Page.stopScreencast').catch(() => {})
    await s.cdp.detach().catch(() => {})
  }

  private sessionFor(tokenText: string): Session | null {
    const s = this.session
    if (!s) return null
    const given = Buffer.from(tokenText, 'base64url')
    return given.length === s.token.length && timingSafeEqual(given, s.token) ? s : null
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://viewer')
    const m = /^\/v\/([A-Za-z0-9_-]{16,64})(\/(?:events|tap|scroll|type|key|cancel))?$/.exec(url.pathname)
    const s = m ? this.sessionFor(m[1]) : null
    if (!m || !s) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' }).end(GONE_PAGE)
      return
    }
    const action = m[2]?.slice(1) ?? ''

    if (req.method === 'GET' && action === '') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8' }).end(VIEWER_PAGE(Boolean(s.card.pin)))
      return
    }
    if (req.method === 'GET' && action === 'events') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream', connection: 'keep-alive' })
      s.clients.add(res)
      req.on('close', () => s.clients.delete(res))
      if (s.last) send(res, 'frame', { w: s.width, h: s.height, img: s.last })
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, SECURITY_HEADERS).end()
      return
    }
    // Only this page may post (blocks other sites from driving the browser).
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
      res.writeHead(403, SECURITY_HEADERS).end()
      return
    }
    const body = await readJson(req)
    const page = s.page
    const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null)

    switch (action) {
      case 'tap': {
        const x = num(body.x, 0, 1)
        const y = num(body.y, 0, 1)
        if (x === null || y === null) break
        await page.mouse.click(x * s.width, y * s.height)
        return ok(res)
      }
      case 'scroll': {
        const x = num(body.x, 0, 1) ?? 0.5
        const y = num(body.y, 0, 1) ?? 0.5
        const dy = num(body.dy, -5, 5)
        if (dy === null) break
        await page.mouse.move(x * s.width, y * s.height)
        await page.mouse.wheel(0, dy * s.height)
        return ok(res)
      }
      case 'type': {
        const text =
          body.field === 'number' ? s.card.cardNumber.replace(/\s+/g, '') :
          body.field === 'pin' ? s.card.pin :
          typeof body.text === 'string' && body.text.length <= 200 ? body.text : null
        if (!text) break
        await page.keyboard.type(text, { delay: 40 })
        return ok(res)
      }
      case 'key': {
        if (typeof body.key !== 'string' || !KEYS.has(body.key)) break
        await page.keyboard.press(body.key)
        return ok(res)
      }
      case 'cancel': {
        ok(res)
        await page.close().catch(() => {})
        return
      }
    }
    res.writeHead(400, SECURITY_HEADERS).end()
  }
}

function ok(res: ServerResponse) {
  res.writeHead(204, SECURITY_HEADERS).end()
}

function send(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c
      if (body.length > MAX_BODY) req.destroy()
    })
    req.on('end', () => {
      try {
        const v: unknown = JSON.parse(body)
        resolve(v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
}

const GONE_PAGE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Balance check</title>
<body style="font:16px system-ui;padding:24px;text-align:center;color:#334155">
<p>This check has finished or the link has expired.</p><p>Go back to the wallet app.</p></body>`

const VIEWER_PAGE = (hasPin: boolean) => `<!doctype html>
<html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Finish balance check</title>
<style>
  body{margin:0;font:15px system-ui,sans-serif;background:#0f172a;color:#e2e8f0}
  header,footer{padding:10px 12px;background:#1e293b}
  header p{margin:0 0 6px}
  #screen{display:block;width:100%;max-width:560px;margin:0 auto;touch-action:none;background:#fff;min-height:200px}
  .row{display:flex;flex-wrap:wrap;gap:6px}
  button{font:inherit;border:0;border-radius:999px;padding:8px 12px;background:#334155;color:#fff}
  button.primary{background:#10b981;color:#052e16;font-weight:600}
  #status{margin:0;font-size:13px;color:#94a3b8}
  #done{display:none;padding:32px 16px;text-align:center}
</style></head><body>
<header>
  <p><b>Your turn:</b> tap “I’m not a robot” in the picture below (and any puzzle it shows), then tap the page’s balance button. The balance is saved automatically.</p>
  <p id=status>Connecting…</p>
</header>
<main id=main><img id=screen alt="Balance check page"></main>
<div id=done></div>
<footer id=tools>
  <div class=row>
    <button data-field=number>Type card number</button>
    ${hasPin ? '<button data-field=pin>Type PIN</button>' : ''}
    <button data-key=Backspace>⌫</button>
    <button data-key=Tab>Tab</button>
    <button data-key=Enter>Enter</button>
    <button id=cancel>Cancel check</button>
  </div>
  <p id=status2 style="margin:6px 0 0;font-size:12px;color:#94a3b8">Tap a field first, then use the Type buttons. Drag up or down to scroll.</p>
</footer>
<script>
(() => {
  const base = location.pathname
  const img = document.getElementById('screen')
  const status = document.getElementById('status')
  const post = (what, body) => fetch(base + '/' + what, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
    .then((r) => { if (!r.ok && r.status !== 204) status.textContent = 'That didn’t go through. Try again.' })
    .catch(() => { status.textContent = 'Lost connection to the checker.' })
  const events = new EventSource(base + '/events')
  events.addEventListener('frame', (e) => {
    const f = JSON.parse(e.data)
    img.src = 'data:image/jpeg;base64,' + f.img
    status.textContent = 'Live'
  })
  events.addEventListener('end', (e) => {
    events.close()
    const ok = JSON.parse(e.data).outcome === 'done'
    document.getElementById('main').style.display = 'none'
    document.getElementById('tools').style.display = 'none'
    const done = document.getElementById('done')
    done.style.display = 'block'
    done.textContent = ok ? 'Done! The balance is in the wallet app. You can close this tab.' : 'The check ended without a balance. See the wallet app.'
    status.textContent = ''
  })
  events.onerror = () => { status.textContent = 'Reconnecting…' }

  const pos = (e) => {
    const r = img.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  let start = null
  img.addEventListener('pointerdown', (e) => { start = { ...pos(e), cy: e.clientY }; img.setPointerCapture(e.pointerId) })
  img.addEventListener('pointerup', (e) => {
    if (!start) return
    const moved = e.clientY - start.cy
    const r = img.getBoundingClientRect()
    if (Math.abs(moved) < 10) post('tap', pos(e))
    else post('scroll', { x: start.x, y: start.y, dy: -moved / r.height })
    start = null
  })
  document.querySelectorAll('[data-field]').forEach((b) => b.addEventListener('click', () => post('type', { field: b.dataset.field })))
  document.querySelectorAll('[data-key]').forEach((b) => b.addEventListener('click', () => post('key', { key: b.dataset.key })))
  document.getElementById('cancel').addEventListener('click', () => { if (confirm('Cancel this balance check?')) post('cancel') })
})()
</script></body></html>`
