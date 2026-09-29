export interface Config {
  supabaseUrl: string
  supabaseAnonKey: string
  email: string
  password: string
  pollIntervalMs: number
  checkTimeoutMs: number
  heartbeatFile: string
  stateDir: string
  /** Assisted checks: address phones use to reach the live view (e.g. http://192.168.1.20:8787). */
  viewerPublicUrl: string | null
  viewerPort: number
  /** Assisted checks wait this long for a person to finish the robot check. */
  assistTimeoutMs: number
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
    viewerPublicUrl: env.VIEWER_PUBLIC_URL?.trim().replace(/\/+$/, '') || null,
    viewerPort: Number(env.VIEWER_PORT ?? 8787),
    assistTimeoutMs: Number(env.ASSIST_TIMEOUT_SECONDS ?? 300) * 1000,
  }
}

/** Where saved merchant sign-ins live (a Docker volume in production). */
export function loadStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.STATE_DIR ?? new URL('../state', import.meta.url).pathname
}
