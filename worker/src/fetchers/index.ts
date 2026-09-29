import { CheckError, type CheckErrorCode } from '../errors'
import { chromium } from 'playwright'
import { sportchekFetcher } from './givex'
import { indigoFetcher } from './indigo'
import type { BalanceFetcher } from './types'

const fetchers: readonly BalanceFetcher[] = [indigoFetcher, sportchekFetcher]

/**
 * Test hook: WORKER_FAKE_BALANCE_CENTS / WORKER_FAKE_ERROR make every provider return a
 * fixed result without contacting the merchant. With WORKER_FAKE_HANDOVER_MS it also
 * hands a blank page to the live view for that long first, like an assisted check.
 * Used by the end-to-end test; never set it in production.
 */
function fakeFetcher(provider: string, env: NodeJS.ProcessEnv): BalanceFetcher | null {
  const cents = env.WORKER_FAKE_BALANCE_CENTS
  const error = env.WORKER_FAKE_ERROR as CheckErrorCode | undefined
  if (cents === undefined && error === undefined) return null
  return {
    provider,
    assisted: env.WORKER_FAKE_HANDOVER_MS !== undefined,
    async fetch(_card, ctx) {
      const handOverMs = Number(env.WORKER_FAKE_HANDOVER_MS)
      if (handOverMs > 0) {
        if (!ctx.handOver) throw new CheckError('no_viewer')
        const browser = await chromium.launch({ executablePath: env.CHROMIUM_PATH || undefined })
        try {
          const page = await browser.newPage({ viewport: { width: 480, height: 860 } })
          await page.setContent('<h1>Pretend balance page</h1>')
          await ctx.handOver(page)
          await new Promise((r) => setTimeout(r, handOverMs))
        } finally {
          await browser.close()
        }
      }
      if (error) throw new CheckError(error)
      return Number(cents)
    },
  }
}

export function getFetcher(provider: string, env: NodeJS.ProcessEnv = process.env): BalanceFetcher | null {
  return fakeFetcher(provider, env) ?? fetchers.find((f) => f.provider === provider) ?? null
}
