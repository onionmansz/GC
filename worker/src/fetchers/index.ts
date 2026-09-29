import { CheckError, type CheckErrorCode } from '../errors'
import { indigoFetcher } from './indigo'
import type { BalanceFetcher } from './types'

const fetchers: readonly BalanceFetcher[] = [indigoFetcher]

/**
 * Test hook: WORKER_FAKE_BALANCE_CENTS / WORKER_FAKE_ERROR make every provider return a
 * fixed result without opening a browser. Used by the end-to-end test; never set it in
 * production.
 */
function fakeFetcher(provider: string, env: NodeJS.ProcessEnv): BalanceFetcher | null {
  const cents = env.WORKER_FAKE_BALANCE_CENTS
  const error = env.WORKER_FAKE_ERROR as CheckErrorCode | undefined
  if (cents === undefined && error === undefined) return null
  return {
    provider,
    async fetch() {
      if (error) throw new CheckError(error)
      return Number(cents)
    },
  }
}

export function getFetcher(provider: string, env: NodeJS.ProcessEnv = process.env): BalanceFetcher | null {
  return fakeFetcher(provider, env) ?? fetchers.find((f) => f.provider === provider) ?? null
}

/** True when a fetcher needs a real browser (the fake one doesn't). */
export function usesBrowser(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WORKER_FAKE_BALANCE_CENTS === undefined && env.WORKER_FAKE_ERROR === undefined
}
