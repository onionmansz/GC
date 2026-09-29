import { useState, type FormEvent } from 'react'
import {
  useCreateInvite,
  useDeleteInvite,
  useInvites,
  useMembers,
  useMerchants,
  useMyHousehold,
  useUpdateDisplayName,
  useUpdateHouseholdName,
} from '../api/queries'
import type { MerchantSummary } from '../api/types'
import { useAuth } from '../auth/AuthProvider'
import { userMessage } from '../lib/errors'
import { clearLocalData, useOnline } from '../lib/queryClient'
import { ErrorText, Field, MerchantDot, Page, Sheet } from '../components/ui'
import { MerchantForm } from '../components/MerchantForm'

export function Settings() {
  const { email, signOut } = useAuth()
  const household = useMyHousehold()
  const members = useMembers()
  const merchants = useMerchants()
  const online = useOnline()
  const [editingMerchant, setEditingMerchant] = useState<MerchantSummary | 'new' | null>(null)

  return (
    <Page title="Settings" back="/">
      <div className="space-y-8 pb-8">
        <Section title="You">
          <p className="mb-3 text-sm text-slate-600">Signed in as {email}</p>
          {household.data && <DisplayNameForm current={household.data.me.display_name} />}
        </Section>

        <Section title="Household">
          {household.data && <HouseholdNameForm id={household.data.household.id} current={household.data.household.name} />}
          <ul className="card mt-4 divide-y divide-slate-100">
            {members.data?.map((m) => (
              <li key={m.user_id} className="px-4 py-3">
                {m.display_name}
              </li>
            ))}
          </ul>
          <InviteForm householdId={household.data?.household.id} />
        </Section>

        <Section title="Merchants">
          <ul className="card divide-y divide-slate-100">
            {merchants.data?.map((m) => (
              <li key={m.merchant_id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  disabled={!online}
                  onClick={() => setEditingMerchant(m)}
                >
                  <MerchantDot color={m.color} />
                  <span className="flex-1">
                    <span className="block font-medium">{m.name}</span>
                    <span className="text-xs text-slate-500">
                      {m.category} · {m.balance_check_url ? 'balance page set' : 'no balance page'}
                    </span>
                  </span>
                  <span className="text-slate-300">›</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-secondary mt-3 w-full" disabled={!online} onClick={() => setEditingMerchant('new')}>
            + Add merchant
          </button>
        </Section>

        <Section title="This device">
          <p className="mb-3 text-sm text-slate-600">
            Your cards are cached on this device so they work offline. Signing out erases the cache.
          </p>
          <div className="space-y-2">
            <button
              type="button"
              className="btn-secondary w-full"
              disabled={!online}
              onClick={async () => {
                await clearLocalData()
                window.location.reload()
              }}
            >
              Clear offline data
            </button>
            <button type="button" className="btn-danger w-full" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-slate-400">v{__APP_VERSION__}</p>
        </Section>
      </div>

      {editingMerchant && (
        <Sheet title={editingMerchant === 'new' ? 'New merchant' : 'Edit merchant'} onClose={() => setEditingMerchant(null)}>
          <MerchantForm merchant={editingMerchant === 'new' ? undefined : editingMerchant} onDone={() => setEditingMerchant(null)} />
        </Sheet>
      )}
    </Page>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  )
}

function DisplayNameForm({ current }: { current: string }) {
  const [name, setName] = useState(current)
  const update = useUpdateDisplayName()
  const online = useOnline()
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate(name)
      }}
    >
      <input aria-label="Your name" className="input" maxLength={50} required value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn-secondary shrink-0" disabled={!online || name.trim() === current || update.isPending}>
        Save
      </button>
    </form>
  )
}

function HouseholdNameForm({ id, current }: { id: string; current: string }) {
  const [name, setName] = useState(current)
  const update = useUpdateHouseholdName()
  const online = useOnline()
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        update.mutate({ id, name })
      }}
    >
      <input aria-label="Household name" className="input" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn-secondary shrink-0" disabled={!online || name.trim() === current || update.isPending}>
        Save
      </button>
    </form>
  )
}

function InviteForm({ householdId }: { householdId: string | undefined }) {
  const invites = useInvites()
  const create = useCreateInvite(householdId)
  const remove = useDeleteInvite()
  const online = useOnline()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const pending = invites.data?.filter((i) => !i.accepted_at) ?? []

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate({ email, displayName: name }, { onSuccess: () => (setEmail(''), setName('')) })
  }

  return (
    <div className="card mt-4 space-y-3 p-4">
      <p className="font-semibold">Invite someone</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>Add their email here.</li>
        <li>
          In Supabase: <span className="font-medium">Authentication → Users → Invite user</span>, same email.
        </li>
        <li>They open the email, then tap “I was invited”.</li>
      </ol>
      {pending.length > 0 && (
        <ul className="space-y-1 text-sm">
          {pending.map((i) => (
            <li key={i.email} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>
                {i.display_name} · {i.email}
              </span>
              <button
                type="button"
                className="text-slate-500 underline"
                disabled={!online}
                onClick={() => remove.mutate({ householdId: i.household_id, email: i.email })}
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Their email">
          {(id) => <input id={id} className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Their name">
          {(id) => <input id={id} className="input" required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <ErrorText>{create.error ? userMessage(create.error, 'invite') : null}</ErrorText>
        <button className="btn-primary w-full" disabled={!online || !householdId || create.isPending}>
          Add invite
        </button>
      </form>
    </div>
  )
}
