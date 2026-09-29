import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearLocalData, useOnline } from '../lib/queryClient'

const LAST_USER_KEY = 'wallet.lastUserId'
const RECOVERY_KEY = 'wallet.passwordRecovery'

function markPasswordRecovery() {
  try {
    sessionStorage.setItem(RECOVERY_KEY, '1')
  } catch {
    // ignore: the user can still change it from Settings
  }
}

function inRecovery(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_KEY) === '1'
  } catch {
    return false
  }
}

interface AuthState {
  status: 'loading' | 'signedIn' | 'signedOut'
  userId: string | undefined
  /** Offline (or auth unreachable) without a live session: cached data is shown until reconnect. */
  offlineOnly: boolean
  email: string | undefined
  /** The signed-in user must set a password before using the app. */
  needsPassword: 'first' | 'recovery' | null
  finishPasswordSetup: () => void
  /** A "forgot password" link was verified: require a new password before continuing. */
  beginPasswordRecovery: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function readLastUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY)
  } catch {
    return null
  }
}

function writeLastUser(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_USER_KEY, id)
    else localStorage.removeItem(LAST_USER_KEY)
  } catch {
    // storage unavailable (private mode): offline cache simply won't be reused
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState(false)
  const [recovery, setRecovery] = useState(inRecovery)
  const online = useOnline()

  // On a weak or absent connection supabase-js can take a long time to settle the
  // session. Don't block the (cached) wallet on it: fall back after a short wait.
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 1500)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const handle = async (next: Session | null) => {
      const id = next?.user.id ?? null
      const last = readLastUser()
      // A different person signed in on this device: drop the previous cache.
      if (id && last && last !== id) await clearLocalData()
      if (id) writeLastUser(id)
      setSession(next)
      setLoading(false)
    }
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') {
        markPasswordRecovery()
        setRecovery(true)
      }
      // Defer: calling other supabase methods inside this callback can deadlock.
      setTimeout(() => void handle(next), 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const beginPasswordRecovery = useCallback(() => {
    markPasswordRecovery()
    setRecovery(true)
  }, [])

  const finishPasswordSetup = useCallback(() => {
    try {
      sessionStorage.removeItem(RECOVERY_KEY)
    } catch {
      // ignore
    }
    setRecovery(false)
    // Pick up user_metadata.password_set from the updated user.
    void supabase.auth.refreshSession().then(({ data }) => data.session && setSession(data.session))
  }, [])

  const signOut = useCallback(async () => {
    try {
      sessionStorage.removeItem(RECOVERY_KEY)
    } catch {
      // ignore
    }
    setRecovery(false)
    await supabase.auth.signOut({ scope: 'local' })
    writeLastUser(null)
    await clearLocalData()
  }, [])

  const value = useMemo<AuthState>(() => {
    const cachedUser = !session && (!online || (loading && slow)) ? readLastUser() : null
    return {
      status: session || cachedUser ? 'signedIn' : loading ? 'loading' : 'signedOut',
      userId: session?.user.id ?? cachedUser ?? undefined,
      offlineOnly: Boolean(cachedUser),
      email: session?.user.email,
      // Invited accounts and accounts from the magic-link era have no password yet.
      needsPassword: !session ? null : recovery ? 'recovery' : session.user.user_metadata?.password_set === true ? null : 'first',
      finishPasswordSetup,
      beginPasswordRecovery,
      signOut,
    }
  }, [loading, slow, session, online, recovery, finishPasswordSetup, beginPasswordRecovery, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
