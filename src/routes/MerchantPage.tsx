import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCards, useMembers, useMerchants } from '../api/queries'
import { formatCents } from '../lib/money'
import { sortByLowestBalance } from '../lib/ledger'
import { maskCardNumber } from '../lib/redact'
import { EmptyState, MerchantDot, Page, Sheet, Splash } from '../components/ui'
import { MerchantForm } from '../components/MerchantForm'
import { useOnline } from '../lib/queryClient'

export function MerchantPage() {
  const { merchantId } = useParams()
  const merchants = useMerchants()
  const cards = useCards()
  const members = useMembers()
  const online = useOnline()
  const [editing, setEditing] = useState(false)

  if (merchants.isPending || cards.isPending) return <Splash />
  const merchant = merchants.data?.find((m) => m.merchant_id === merchantId)
  if (!merchant) return <Page title="Not found" back="/"><EmptyState>That merchant doesn't exist.</EmptyState></Page>

  const list = sortByLowestBalance((cards.data ?? []).filter((c) => c.merchant_id === merchantId && !c.archived))
  const holder = (id: string | null) => members.data?.find((m) => m.user_id === id)?.display_name

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          <MerchantDot color={merchant.color} />
          {merchant.name}
        </span>
      }
      back="/"
      actions={
        <button type="button" className="text-sm font-medium text-slate-600" disabled={!online} onClick={() => setEditing(true)}>
          Edit
        </button>
      }
    >
      <p className="mb-4 text-slate-600">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{formatCents(merchant.total_balance_cents)}</span> across{' '}
        {list.length} {list.length === 1 ? 'card' : 'cards'}
      </p>

      {list.length === 0 ? (
        <EmptyState action={online ? { to: `/cards/new?merchant=${merchant.merchant_id}`, label: 'Add a card' } : undefined}>
          No active cards for {merchant.name}.
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-slate-100" data-testid="merchant-cards">
          {list.map((c) => (
            <li key={c.id}>
              <Link to={`/c/${c.id}`} className="flex items-center gap-3 px-4 py-4">
                <span className="flex-1">
                  <span className="block font-semibold text-slate-900">{c.label || maskCardNumber(c.card_number)}</span>
                  <span className="text-sm text-slate-500">
                    {c.label ? maskCardNumber(c.card_number) : null}
                    {c.label && holder(c.held_by) ? ' · ' : null}
                    {holder(c.held_by) ? `${holder(c.held_by)} has it` : null}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{formatCents(c.balance_cents)}</span>
                <span className="text-slate-300">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {online && list.length > 0 && (
        <Link to={`/cards/new?merchant=${merchant.merchant_id}`} className="btn-secondary mt-4 w-full">
          + Add {merchant.name} card
        </Link>
      )}

      {editing && (
        <Sheet title="Edit merchant" onClose={() => setEditing(false)}>
          <MerchantForm merchant={merchant} onDone={() => setEditing(false)} />
        </Sheet>
      )}
    </Page>
  )
}
