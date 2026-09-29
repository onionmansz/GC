import { Link } from 'react-router-dom'
import { useCards, useMerchants, useSetArchived } from '../api/queries'
import { formatCents } from '../lib/money'
import { maskCardNumber } from '../lib/redact'
import { userMessage } from '../lib/errors'
import { useOnline } from '../lib/queryClient'
import { EmptyState, ErrorText, MerchantDot, Page, Splash } from '../components/ui'

export function Archived() {
  const cards = useCards()
  const merchants = useMerchants()
  const setArchived = useSetArchived()
  const online = useOnline()

  if (cards.isPending) return <Splash />
  const list = (cards.data ?? [])
    .filter((c) => c.archived)
    .sort((a, b) => (b.last_activity_at ?? b.created_at).localeCompare(a.last_activity_at ?? a.created_at))
  const merchant = (id: string) => merchants.data?.find((m) => m.merchant_id === id)

  return (
    <Page title="Archived" back="/">
      <p className="mb-4 text-sm text-slate-600">Cards move here automatically when they reach $0.00.</p>
      <ErrorText>{setArchived.error ? userMessage(setArchived.error, 'unarchive') : null}</ErrorText>
      {list.length === 0 ? (
        <EmptyState>No archived cards.</EmptyState>
      ) : (
        <ul className="card divide-y divide-slate-100">
          {list.map((c) => {
            const m = merchant(c.merchant_id)
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <Link to={`/c/${c.id}`} className="flex flex-1 items-center gap-3">
                  {m && <MerchantDot color={m.color} />}
                  <span className="flex-1">
                    <span className="block font-medium">{m?.name}</span>
                    <span className="text-sm text-slate-500">{c.label || maskCardNumber(c.card_number)}</span>
                  </span>
                  <span className="tabular-nums text-slate-600">{formatCents(c.balance_cents)}</span>
                </Link>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"
                  disabled={!online || setArchived.isPending}
                  onClick={() => setArchived.mutate({ cardId: c.id, archived: false })}
                >
                  Unarchive
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}
