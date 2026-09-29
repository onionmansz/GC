import { useState, type FormEvent } from 'react'
import { supabase, isConfigured } from '../lib/supabase'
import { useOnline } from '../lib/queryClient'
import { ErrorText, OfflineBanner } from '../components/ui'
import { logError } from '../lib/redact'

export function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const online = useOnline()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    // Uninvited addresses get the same response, so the form can't be used to probe who has access.
    if (error && error.status !== 400 && error.status !== 422) {
      logError('login', error)
      setError(error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'Could not send the link. Try again.')
      return
    }
    setSent(true)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <OfflineBanner />
      <h1 className="mb-1 text-3xl font-bold text-slate-900">Gift Cards</h1>
      <p className="mb-8 text-slate-600">Your household's gift card wallet.</p>
      {!isConfigured && <ErrorText>App is missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.</ErrorText>}
      {sent ? (
        <div className="card p-5">
          <p className="font-semibold">Check your email</p>
          <p className="mt-1 text-sm text-slate-600">
            If <span className="font-medium">{email}</span> has access, a sign-in link is on its way. Open it on this device.
          </p>
          <button type="button" className="mt-4 text-sm text-slate-600 underline" onClick={() => setSent(false)}>
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full" disabled={busy || !online || !isConfigured}>
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          <p className="text-center text-xs text-slate-500">Invite only. Ask your household to add you.</p>
        </form>
      )}
    </div>
  )
}
