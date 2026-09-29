import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase, isConfigured } from '../lib/supabase'
import { useOnline } from '../lib/queryClient'
import { ErrorText, OfflineBanner } from '../components/ui'
import { logError } from '../lib/redact'

export function Login() {
  const [mode, setMode] = useState<'signIn' | 'forgot'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const online = useOnline()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Signing in always starts on Home, not wherever the last session ended.
  useEffect(() => {
    if (pathname !== '/') navigate('/', { replace: true })
  }, [pathname, navigate])

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setBusy(false)
    if (!error) return // AuthProvider picks up the new session.
    if (error.status === 400 || error.code === 'invalid_credentials') {
      setError('Wrong email or password.')
    } else if (error.status === 429) {
      setError('Too many attempts. Wait a minute and try again.')
    } else {
      logError('login', error)
      setError("Couldn't sign in. Check your connection and try again.")
    }
  }

  async function sendReset(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/set-password`,
    })
    setBusy(false)
    // Same message whether or not the address has an account.
    if (error && error.status === 429) {
      setError('Too many attempts. Wait a minute and try again.')
      return
    }
    if (error) logError('reset-password', error)
    setResetSent(true)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <OfflineBanner />
      <h1 className="mb-1 text-3xl font-bold text-slate-900">Gift Cards</h1>
      <p className="mb-8 text-slate-600">Your household's gift card wallet.</p>
      {!isConfigured && <ErrorText>App is missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.</ErrorText>}

      {mode === 'signIn' ? (
        <form onSubmit={signIn} className="space-y-4">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full" disabled={busy || !online || !isConfigured}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button
            type="button"
            className="w-full text-center text-sm text-slate-600 underline"
            onClick={() => {
              setMode('forgot')
              setError('')
            }}
          >
            Forgot password?
          </button>
          <p className="text-center text-xs text-slate-500">Invite only. Ask your household to add you.</p>
        </form>
      ) : resetSent ? (
        <div className="card p-5">
          <p className="font-semibold">Check your email</p>
          <p className="mt-1 text-sm text-slate-600">
            If <span className="font-medium">{email}</span> has an account, a link to set a new password is on its way.
          </p>
          <button type="button" className="mt-4 text-sm text-slate-600 underline" onClick={() => (setMode('signIn'), setResetSent(false))}>
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={sendReset} className="space-y-4">
          <p className="text-sm text-slate-600">Enter your email and we'll send a link to set a new password.</p>
          <div>
            <label htmlFor="reset-email" className="label">
              Email
            </label>
            <input
              id="reset-email"
              className="input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full" disabled={busy || !online || !isConfigured}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
          <button type="button" className="w-full text-center text-sm text-slate-600 underline" onClick={() => setMode('signIn')}>
            Back to sign in
          </button>
        </form>
      )}
    </div>
  )
}
