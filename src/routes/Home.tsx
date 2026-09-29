import { Link } from 'react-router-dom'
import { useCards, useMerchants, useMyHousehold } from '../api/queries'
import { groupByCategory } from '../lib/grouping'
import { formatCents } from '../lib/money'
import { EmptyState, LastSynced, MerchantDot, Page, Splash } from '../components/ui'
import { useOnline } from '../lib/queryClient'

export function Home() {
  const household = useMyHousehold()
  const merchants = useMerchants()
  const cards = useCards()
  const online = useOnline()

  if (merchants.isPending) return <Splash />

  const groups = groupByCategory(merchants.data ?? [])
  const grandTotal = groups.reduce((s, g) => s + g.totalCents, 0)
  const activeCards = groups.reduce((s, g) => s + g.merchants.reduce((n, m) => n + m.active_card_count, 0), 0)
  const archivedCount = cards.data?.filter((c) => c.archived).length ?? 0
  const updatedAt = Math.min(merchants.dataUpdatedAt || Infinity, cards.dataUpdatedAt || Infinity)

  return (
    <Page
      title={household.data?.household.name ?? 'Gift Cards'}
      actions={
        <Link to="/settings" className="rounded-lg px-2 py-1 text-sm font-medium text-slate-600" aria-label="Settings">
          Settings
        </Link>
      }
    >
      <section className="mb-6 rounded-3xl bg-slate-900 px-5 py-6 text-white">
        <p className="text-sm text-slate-300">Total available</p>
        <p className="text-4xl font-bold tabular-nums" data-testid="grand-total">
          {formatCents(grandTotal)}
        </p>
        <p className="mt-1 text-sm text-slate-300">
          {activeCards} {activeCards === 1 ? 'card' : 'cards'}
        </p>
      </section>

      <div className="mb-4 flex items-center justify-between">
        <LastSynced updatedAt={Number.isFinite(updatedAt) ? updatedAt : 0} />
        {archivedCount > 0 && (
          <Link to="/archived" className="text-sm text-slate-600 underline">
            Archived ({archivedCount})
          </Link>
        )}
      </div>

      {merchants.isError && !merchants.data && <EmptyState>Couldn't load your cards.</EmptyState>}

      {groups.length === 0 && merchants.data ? (
        <EmptyState action={online ? { to: '/cards/new', label: 'Add your first card' } : undefined}>
          No active gift cards yet.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.category}>
              <h2 className="mb-2 flex justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{g.category}</span>
                <span className="tabular-nums">{formatCents(g.totalCents)}</span>
              </h2>
              <ul className="card divide-y divide-slate-100">
                {g.merchants.map((m) => (
                  <li key={m.merchant_id}>
                    <Link to={`/m/${m.merchant_id}`} className="flex items-center gap-3 px-4 py-4">
                      <MerchantDot color={m.color} />
                      <span className="flex-1">
                        <span className="block font-semibold text-slate-900">{m.name}</span>
                        <span className="text-sm text-slate-500">
                          {m.active_card_count} {m.active_card_count === 1 ? 'card' : 'cards'}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">{formatCents(m.total_balance_cents)}</span>
                      <span className="text-slate-300">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {online && groups.length > 0 && (
        <Link
          to="/cards/new"
          className="btn-primary fixed right-4 bottom-[max(env(safe-area-inset-bottom),1rem)] z-20 rounded-full px-6 shadow-lg"
        >
          + Add card
        </Link>
      )}
      <div className="h-20" />
    </Page>
  )
}
