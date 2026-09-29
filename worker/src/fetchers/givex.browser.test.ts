import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { chromium, type Page } from 'playwright'
import { givexFetcher } from './givex'
import { Viewer } from '../viewer'

// Drives the assisted Givex check (real Chromium) against a local imitation of a Givex
// balance page whose "I'm not a robot" box lives in a cross-origin frame, with a
// "person" who uses only the live view's HTTP interface, like a phone would.

const GOOD = { cardNumber: '6006 4912 3456 7890 123', pin: '4321' }

function page(port: number) {
  return `<!doctype html><html><body>
<h1>Check your gift card balance</h1>
<form method=post action=/balcheck>
  <label>Card Number <input name=cardnum></label>
  <label>PIN <input name=pin type=password></label>
  <iframe src="http://localhost:${port}/robot" style="width:300px;height:80px;border:0"></iframe>
  <button id=go disabled>Check Balance</button>
</form>
<script>addEventListener('message', (e) => { if (e.data === 'human') document.getElementById('go').disabled = false })</script>
</body></html>`
}

const ROBOT = `<!doctype html><body style="margin:0">
<label style="font-size:20px"><input id=robot type=checkbox style="width:40px;height:40px"
  onchange="parent.postMessage('human', '*')"> I'm not a robot</label></body>`

function startFixture(): Promise<Server> {
  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/balcheck' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(page(port))
    } else if (url.pathname === '/refused') {
      // Like the bot protection cutting the connection for the form's frame.
      res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Check Balance</h1><iframe src="/cut"></iframe>')
    } else if (url.pathname === '/cut') {
      req.socket.destroy()
    } else if (url.pathname === '/robot') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(ROBOT)
    } else if (url.pathname === '/balcheck' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const f = new URLSearchParams(body)
        const ok = f.get('cardnum') === GOOD.cardNumber.replace(/\s+/g, '') && f.get('pin') === GOOD.pin
        res.writeHead(200, { 'content-type': 'text/html' }).end(
          ok ? '<h1>Balance</h1><p>Card Balance: $25.00</p>' : '<p>The card number or PIN is invalid.</p>',
        )
      })
    } else {
      res.writeHead(404).end()
    }
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

describe.skipIf(!canRun)('assisted Givex check with the live view', () => {
  let server: Server
  let viewer: Viewer
  let viewerOrigin: string
  let pageUrl: string

  beforeAll(async () => {
    server = await startFixture()
    pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/balcheck`
    viewer = new Viewer('http://viewer.invalid', 0)
    viewerOrigin = `http://127.0.0.1:${await viewer.start()}`
  })

  afterAll(async () => {
    await viewer?.stop()
    server?.close()
  })

  /** Runs a check; `person` gets the live-view link and the page (only to find where things are). */
  async function run(card: { cardNumber: string; pin: string | null }, person: (link: string, page: Page) => Promise<void>) {
    const fetcher = givexFetcher('test', () => pageUrl)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    let personDone: Promise<void> = Promise.resolve()
    try {
      const cents = await fetcher.fetch(card, {
        signal: ctrl.signal,
        stateDir: '/nonexistent',
        async handOver(p) {
          const link = (await viewer.open(p, card)).replace('http://viewer.invalid', viewerOrigin)
          personDone = person(link, p)
        },
      })
      await personDone
      return cents
    } catch (err) {
      await personDone // a failed expectation in `person` is the more useful error
      throw err
    } finally {
      clearTimeout(timer)
      await viewer.close()
    }
  }

  const tapAt = async (link: string, p: Page, box: { x: number; y: number; width: number; height: number } | null) => {
    const vp = p.viewportSize()!
    const r = await fetch(`${link}/tap`, {
      method: 'POST',
      body: JSON.stringify({ x: (box!.x + box!.width / 2) / vp.width, y: (box!.y + box!.height / 2) / vp.height }),
    })
    expect(r.status).toBe(204)
  }

  it('prefills the card, the person ticks the robot box and submits in the live view, and the balance is read', async () => {
    const cents = await run(GOOD, async (link, p) => {
      // The live-view page: no card data in it, and only this check's token works.
      const html = await (await fetch(link)).text()
      expect(html).toContain('Your turn')
      expect(html).not.toContain('6006')
      expect(html).not.toContain(GOOD.pin)
      expect((await fetch(link.replace(/\/v\/.{8}/, '/v/AAAAAAAA'))).status).toBe(404)
      expect((await fetch(`${link}/tap`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' }, body: '{}' })).status).toBe(403)

      // Pictures arrive.
      const events = await fetch(`${link}/events`)
      const reader = events.body!.getReader()
      const first = new TextDecoder().decode((await reader.read()).value)
      expect(first).toMatch(/^event: frame\ndata: \{"w":480,"h":860,"img":"/)
      await reader.cancel()

      await tapAt(link, p, await p.frameLocator('iframe').locator('#robot').boundingBox())
      await expect.poll(() => p.locator('#go').isEnabled()).toBe(true)
      await tapAt(link, p, await p.locator('#go').boundingBox())
    })
    expect(cents).toBe(2500)
  }, 60_000)

  it('reports a rejected card as invalid_card', async () => {
    await expect(
      run({ cardNumber: '0000', pin: '0000' }, async (link, p) => {
        await tapAt(link, p, await p.frameLocator('iframe').locator('#robot').boundingBox())
        await expect.poll(() => p.locator('#go').isEnabled()).toBe(true)
        await tapAt(link, p, await p.locator('#go').boundingBox())
      }),
    ).rejects.toMatchObject({ code: 'invalid_card' })
  }, 60_000)

  it('stops when the person cancels, and the link stops working', async () => {
    let link = ''
    await expect(
      run(GOOD, async (l) => {
        link = l
        expect((await fetch(`${l}/cancel`, { method: 'POST', body: '{}' })).status).toBe(204)
      }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect((await fetch(link)).status).toBe(404)
  }, 60_000)

  it('the "Type PIN" button types the PIN without it ever reaching the phone', async () => {
    const cents = await run({ ...GOOD }, async (link, p) => {
      await p.locator('input[name=pin]').fill('')
      await tapAt(link, p, await p.locator('input[name=pin]').boundingBox())
      expect((await fetch(`${link}/type`, { method: 'POST', body: JSON.stringify({ field: 'pin' }) })).status).toBe(204)
      await tapAt(link, p, await p.frameLocator('iframe').locator('#robot').boundingBox())
      await expect.poll(() => p.locator('#go').isEnabled()).toBe(true)
      await tapAt(link, p, await p.locator('#go').boundingBox())
    })
    expect(cents).toBe(2500)
  }, 60_000)

  it('needs the live view to be configured', async () => {
    await expect(
      givexFetcher('test', () => pageUrl).fetch(GOOD, { signal: new AbortController().signal, stateDir: '/x' }),
    ).rejects.toMatchObject({ code: 'no_viewer' })
  })
  it('reports a refused balance form as blocked, without handing over', async () => {
    let handedOver = false
    const base = pageUrl.replace('/balcheck', '')
    await expect(
      givexFetcher('test', () => `${base}/refused`).fetch(GOOD, {
        signal: new AbortController().signal,
        stateDir: '/x',
        handOver: async () => {
          handedOver = true
        },
      }),
    ).rejects.toMatchObject({ code: 'blocked' })
    expect(handedOver).toBe(false)
  }, 60_000)
})
