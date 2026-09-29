import { writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadConfig, type Config } from './config'
import { CheckError, errorCodeOf } from './errors'
import { getFetcher } from './fetchers/index'

// Balance-check worker. Signs in as the household's "Auto-check" service member
// (email + password, ordinary user: RLS applies), polls for queued checks, runs the
// merchant's lookup and reports the result. Logs contain request ids and outcome
// codes only; never card numbers, PINs or page content.

interface Job {
  request_id: string
  card_id: string
  provider: string
  card_number: string
  pin: string | null
}

function log(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`)
}

async function signIn(sb: SupabaseClient, cfg: Config) {
  const { error } = await sb.auth.signInWithPassword({ email: cfg.email, password: cfg.password })
  if (error) throw new Error(`sign-in failed (${error.code ?? error.status})`)
  log('signed in')
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await Promise.race([
      run(ctrl.signal),
      new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new CheckError('timeout')))),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function runJob(job: Job, cfg: Config): Promise<{ cents: number } | { error: string }> {
  const fetcher = getFetcher(job.provider)
  if (!fetcher) return { error: 'not_supported' }
  try {
    return await withTimeout(cfg.checkTimeoutMs, async (signal) => {
      const cents = await fetcher.fetch({ cardNumber: job.card_number, pin: job.pin }, { signal, fetch: globalThis.fetch })
      if (!Number.isSafeInteger(cents) || cents < 0) throw new CheckError('site_changed')
      return { cents }
    })
  } catch (err) {
    return { error: errorCodeOf(err) }
  }
}

async function main() {
  const cfg = loadConfig()
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  })
  await signIn(sb, cfg)

  let stopping = false
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stopping = true))

  let failures = 0
  while (!stopping) {
    await writeFile(cfg.heartbeatFile, String(Date.now())).catch(() => {})
    const { data, error } = await sb.rpc('claim_balance_check')
    if (error) {
      failures++
      log(`claim failed (${error.code ?? 'network'})`)
      if (error.code === 'PGRST301' || error.message?.includes('JWT')) await signIn(sb, cfg).catch(() => {})
      await sleep(Math.min(60_000, cfg.pollIntervalMs * 2 ** failures))
      continue
    }
    failures = 0
    const job = (data as Job[] | null)?.[0]
    if (!job) {
      await sleep(cfg.pollIntervalMs)
      continue
    }

    const started = Date.now()
    const outcome = await runJob(job, cfg)
    const done = await sb.rpc('complete_balance_check', {
      p_request_id: job.request_id,
      p_balance_cents: 'cents' in outcome ? outcome.cents : null,
      p_error_code: 'error' in outcome ? outcome.error : null,
    })
    const result = 'cents' in outcome ? 'ok' : `failed:${outcome.error}`
    log(`request ${job.request_id} provider=${job.provider} ${result} in ${Date.now() - started}ms${done.error ? ` (report failed: ${done.error.code})` : ''}`)
  }
  log('stopped')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'fatal error')
  process.exit(1)
})
