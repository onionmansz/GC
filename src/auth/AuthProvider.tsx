import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearLocalData, useOnline } from '../lib/queryClient'

const LAST_USER_KEY = 'wallet.lastUserId'

interface AuthState {
  status: 'loading' | 'signedIn' | 'signedOut'
  userId: string | undefined
  /** Offline with an expired session: cached data is shown read-only until reconnect. */
  offlineOnly: boolean
  email: string | undefined
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
  const online = useOnline()

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
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      // Defer: calling other supabase methods inside this callback can deadlock.
      setTimeout(() => void handle(next), 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: 'local' })
    writeLastUser(null)
    await clearLocalData()
  }, [])

  const value = useMemo<AuthState>(() => {
    const cachedUser = !session && !online ? readLastUser() : null
    return {
      status: loading ? 'loading' : session || cachedUser ? 'signedIn' : 'signedOut',
      userId: session?.user.id ?? cachedUser ?? undefined,
      offlineOnly: Boolean(cachedUser),
      email: session?.user.email,
      signOut,
    }
  }, [loading, session, online, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
