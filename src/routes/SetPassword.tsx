import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useOnline } from '../lib/queryClient'
import { logError } from '../lib/redact'
import { ErrorText, OfflineBanner } from '../components/ui'
import { checkNewPassword, MIN_PASSWORD_LENGTH } from '../lib/password'

/**
 * Shown after an invite link (first visit), after a "forgot password" link, and from
 * Settings → Change password. Marks the account so the first-visit prompt stops.
 */
export function SetPassword({ reason }: { reason: 'first' | 'recovery' | 'change' }) {
  const { email, finishPasswordSetup, signOut } = useAuth()
  const navigate = useNavigate()
  const online = useOnline()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = checkNewPassword(password, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } })
    setBusy(false)
    if (error) {
      if (error.code === 'weak_password') setError('That password is too common or too weak. Try a longer one.')
      else if (error.code === 'same_password') setError('That is your current password. Choose a new one.')
      else if (error.code === 'reauthentication_needed') setError('For security, sign out and use “Forgot password?” to change it.')
      else {
        logError('set-password', error)
        setError("Couldn't save the password. Try again.")
      }
      return
    }
    finishPasswordSetup()
    navigate('/', { replace: true })
  }

  const title = { first: 'Choose a password', recovery: 'Set a new password', change: 'Change password' }[reason]

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <OfflineBanner />
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-slate-600">
          {reason === 'first' ? "You'll use it with " : 'For '}
          {email}
          {reason === 'first' ? ' to sign in from now on.' : '.'}
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        {/* Hidden username field helps password managers save the right account. */}
        <input type="email" autoComplete="username" value={email ?? ''} readOnly hidden />
        <div>
          <label htmlFor="new-password" className="label">
            New password
          </label>
          <input
            id="new-password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>
        <div>
          <label htmlFor="confirm-password" className="label">
            Confirm password
          </label>
          <input
            id="confirm-password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy || !online}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
        {reason === 'change' ? (
          <button type="button" className="btn-secondary w-full" onClick={() => navigate(-1)}>
            Cancel
          </button>
        ) : (
          <button type="button" className="w-full text-center text-sm text-slate-500 underline" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </form>
    </div>
  )
}
