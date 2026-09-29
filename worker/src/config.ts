export interface Config {
  supabaseUrl: string
  supabaseAnonKey: string
  email: string
  password: string
  pollIntervalMs: number
  checkTimeoutMs: number
  heartbeatFile: string
  stateDir: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'WORKER_EMAIL', 'WORKER_PASSWORD'].filter((k) => !env[k])
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`)
  return {
    supabaseUrl: env.SUPABASE_URL!,
    supabaseAnonKey: env.SUPABASE_ANON_KEY!,
    email: env.WORKER_EMAIL!,
    password: env.WORKER_PASSWORD!,
    pollIntervalMs: Number(env.POLL_INTERVAL_SECONDS ?? 5) * 1000,
    checkTimeoutMs: Number(env.CHECK_TIMEOUT_SECONDS ?? 120) * 1000,
    heartbeatFile: env.HEARTBEAT_FILE ?? '/tmp/worker-heartbeat',
    stateDir: loadStateDir(env),
  }
}

/** Where saved merchant sign-ins live (a Docker volume in production). */
export function loadStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.STATE_DIR ?? new URL('../state', import.meta.url).pathname
}
