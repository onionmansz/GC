import { useState, type FormEvent } from 'react'
import { useAcceptInvite, useCreateHousehold } from '../api/queries'
import { useAuth } from '../auth/AuthProvider'
import { useOnline } from '../lib/queryClient'
import { userMessage } from '../lib/errors'
import { ErrorText, OfflineBanner } from '../components/ui'

/** First run for a signed-in user who isn't in a household yet. */
export function Setup() {
  const { email, signOut } = useAuth()
  const online = useOnline()
  const [displayName, setDisplayName] = useState('')
  const [householdName, setHouseholdName] = useState('Home')
  const accept = useAcceptInvite()
  const create = useCreateHousehold()
  const [mode, setMode] = useState<'choose' | 'create'>('choose')

  function join() {
    create.reset()
    accept.mutate({ displayName })
  }

  function submitCreate(e: FormEvent) {
    e.preventDefault()
    accept.reset()
    create.mutate({ name: householdName, displayName })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <OfflineBanner />
      <div>
        <h1 className="text-2xl font-bold">Welcome</h1>
        <p className="text-sm text-slate-600">Signed in as {email}</p>
      </div>

      <div>
        <label htmlFor="display-name" className="label">
          Your name (shown in the card history)
        </label>
        <input
          id="display-name"
          className="input"
          value={displayName}
          maxLength={50}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Sam"
        />
      </div>

      {mode === 'choose' ? (
        <div className="space-y-3">
          <button type="button" className="btn-primary w-full" disabled={!online || accept.isPending} onClick={join}>
            {accept.isPending ? 'Joining…' : 'I was invited — join my household'}
          </button>
          <ErrorText>{accept.error ? userMessage(accept.error, 'accept-invite') : null}</ErrorText>
          <button type="button" className="btn-secondary w-full" onClick={() => setMode('create')}>
            Create a new household
          </button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={submitCreate}>
          <div>
            <label htmlFor="household-name" className="label">
              Household name
            </label>
            <input
              id="household-name"
              className="input"
              required
              maxLength={100}
              value={householdName}
              onChange={(e) => setHouseholdName(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500">
            Creates your household with Indigo, Esso and Tim Hortons ready to go. You can invite your partner from Settings.
          </p>
          <ErrorText>{create.error ? userMessage(create.error, 'create-household') : null}</ErrorText>
          <button className="btn-primary w-full" disabled={!online || !displayName.trim() || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create household'}
          </button>
          <button type="button" className="btn-secondary w-full" onClick={() => setMode('choose')}>
            Back
          </button>
        </form>
      )}

      <button type="button" className="text-sm text-slate-500 underline" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}
