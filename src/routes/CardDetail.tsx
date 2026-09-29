import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useCard,
  useDeleteCard,
  useLatestBalanceCheck,
  useRequestBalanceCheck,
  useMembers,
  useMerchants,
  useRecordTransaction,
  useSetArchived,
  useSetBalance,
  useTransactions,
} from '../api/queries'
import type { CardWithBalance, MerchantSummary } from '../api/types'
import { centsToInput, formatCents, formatSignedCents, parseMoneyToCents } from '../lib/money'
import { adjustDelta, checkLoad, checkSpend } from '../lib/ledger'
import { userMessage } from '../lib/errors'
import { useOnline } from '../lib/queryClient'
import { formatDateTime, timeAgo } from '../lib/time'
import { checkFailureMessage, isStalePending } from '../lib/autoCheck'
import { EmptyState, ErrorText, MaskedNumber, MaskedPin, MerchantDot, MoneyInput, Page, Sheet, Splash } from '../components/ui'

type Action = 'spend' | 'load' | 'set'

const TYPE_LABEL = { load: 'Added', spend: 'Spent', adjust: 'Balance set' } as const

export function CardDetail() {
  const { cardId } = useParams()
  const card = useCard(cardId)
  const merchants = useMerchants()
  const members = useMembers()
  const online = useOnline()
  const [action, setAction] = useState<Action | null>(null)
  const [copied, setCopied] = useState(false)

  if (card.isPending) return <Splash />
  if (!card.data) {
    return (
      <Page title="Card" back="/">
        <EmptyState>This card no longer exists.</EmptyState>
      </Page>
    )
  }
  const c = card.data
  const merchant = merchants.data?.find((m) => m.merchant_id === c.merchant_id)
  const holder = members.data?.find((m) => m.user_id === c.held_by)?.display_name

  function checkBalance() {
    if (!merchant?.balance_check_url) return
    // Both calls happen synchronously inside the tap, which iOS requires for clipboard and pop-ups.
    void navigator.clipboard?.writeText(c.card_number).then(
      () => setCopied(true),
      () => setCopied(false),
    )
    window.open(merchant.balance_check_url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          {merchant && <MerchantDot color={merchant.color} />}
          {merchant?.name ?? 'Card'}
        </span>
      }
      back={merchant && !c.archived ? `/m/${merchant.merchant_id}` : c.archived ? '/archived' : '/'}
      actions={
        online ? (
          <Link to={`/c/${c.id}/edit`} className="text-sm font-medium text-slate-600">
            Edit
          </Link>
        ) : null
      }
    >
      <section className="card mb-4 p-5">
        {c.label && <p className="text-sm font-medium text-slate-500">{c.label}</p>}
        <p className="text-4xl font-bold tabular-nums" data-testid="card-balance">
          {formatCents(c.balance_cents)}
        </p>
        {c.archived && <p className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Archived</p>}
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Number</dt>
          <dd>
            <MaskedNumber number={c.card_number} />
          </dd>
          <dt className="text-slate-500">PIN</dt>
          <dd>
            <MaskedPin pin={c.pin} />
          </dd>
          {holder && (
            <>
              <dt className="text-slate-500">Held by</dt>
              <dd>{holder}</dd>
            </>
          )}
          <dt className="text-slate-500">Checked</dt>
          <dd>{c.balance_checked_at ? timeAgo(c.balance_checked_at) : 'Never'}</dd>
        </dl>
      </section>

      <Link to={`/c/${c.id}/till`} className="btn-primary mb-3 w-full py-4 text-lg" data-testid="show-at-till">
        Show at till
      </Link>

      {!online && <p className="mb-3 text-center text-sm text-amber-800">Reconnect to record spending or change the balance.</p>}

      <div className="mb-3 grid grid-cols-3 gap-2">
        <button type="button" className="btn-secondary px-2" disabled={!online} onClick={() => setAction('spend')}>
          Spent $
        </button>
        <button type="button" className="btn-secondary px-2" disabled={!online} onClick={() => setAction('load')}>
          Add funds
        </button>
        <button type="button" className="btn-secondary px-2" disabled={!online} onClick={() => setAction('set')}>
          Set balance
        </button>
      </div>

      {merchant?.balance_check_url && (
        <button type="button" className="btn-secondary mb-1 w-full" onClick={checkBalance}>
          Check balance ↗
        </button>
      )}
      {copied && <p className="mb-2 text-center text-xs text-slate-500">Card number copied. Paste it on the balance page.</p>}

      {merchant?.auto_check && <AutoCheck card={c} />}

      <Ledger card={c} />

      <ArchiveControls card={c} />

      {action && merchant && (
        <AmountSheet action={action} card={c} merchant={merchant} onClose={() => setAction(null)} />
      )}
    </Page>
  )
}

function AutoCheck({ card }: { card: CardWithBalance }) {
  const online = useOnline()
  const latest = useLatestBalanceCheck(card.id, true)
  const request = useRequestBalanceCheck()
  const check = latest.data
  const active = check?.status === 'pending' || check?.status === 'running'

  let status: React.ReactNode = null
  if (request.error) status = <span className="text-red-700">{userMessage(request.error, 'request-check')}</span>
  else if (check && active) {
    status = isStalePending(check.status, check.created_at)
      ? "Still waiting. The checker on your home server doesn't seem to be running."
      : check.status === 'running'
        ? 'Checking with the merchant…'
        : 'Queued…'
  } else if (check?.status === 'done' && check.result_cents !== null && check.finished_at) {
    status = `Auto-checked ${timeAgo(check.finished_at)}: ${formatCents(check.result_cents)}`
  } else if (check?.status === 'failed') {
    status = <span className="text-amber-800">{checkFailureMessage(check.error_code)}</span>
  }

  return (
    <div className="mb-1" data-testid="auto-check">
      <button
        type="button"
        className="btn-secondary w-full"
        disabled={!online || active || request.isPending}
        onClick={() => request.mutate(card.id)}
      >
        {active ? 'Checking balance…' : 'Check balance now (automatic)'}
      </button>
      {status && (
        <p className="mt-1 text-center text-xs text-slate-600" role="status" data-testid="auto-check-status">
          {status}
        </p>
      )}
    </div>
  )
}

function Ledger({ card }: { card: CardWithBalance }) {
  const tx = useTransactions(card.id)
  const members = useMembers()
  const name = (id: string) => members.data?.find((m) => m.user_id === id)?.display_name ?? 'Former member'

  return (
    <section className="mt-6">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">History</h2>
      {tx.isPending ? (
        <p className="px-1 text-sm text-slate-500">Loading…</p>
      ) : !tx.data?.length ? (
        <p className="px-1 text-sm text-slate-500">{tx.isError ? "Couldn't load history." : 'No transactions yet.'}</p>
      ) : (
        <ul className="card divide-y divide-slate-100" data-testid="ledger">
          {tx.data.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="font-medium">
                  {TYPE_LABEL[t.type]}
                  {t.note ? <span className="font-normal text-slate-600"> · {t.note}</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {name(t.created_by)} · <time dateTime={t.created_at}>{formatDateTime(t.created_at)}</time>
                </p>
              </div>
              <span className={`font-semibold tabular-nums ${t.amount_cents < 0 ? 'text-slate-900' : 'text-emerald-700'}`}>
                {formatSignedCents(t.amount_cents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ArchiveControls({ card }: { card: CardWithBalance }) {
  const online = useOnline()
  const navigate = useNavigate()
  const setArchived = useSetArchived()
  const del = useDeleteCard()
  const error = setArchived.error ?? del.error

  return (
    <section className="mt-8 space-y-2">
      <button
        type="button"
        className="btn-secondary w-full"
        disabled={!online || setArchived.isPending}
        onClick={() => setArchived.mutate({ cardId: card.id, archived: !card.archived })}
      >
        {card.archived ? 'Unarchive' : 'Archive'}
      </button>
      <button
        type="button"
        className="btn-danger w-full"
        disabled={!online || del.isPending}
        onClick={() => {
          if (confirm('Delete this card and its history? This cannot be undone.')) {
            del.mutate(card, { onSuccess: () => navigate('/', { replace: true }) })
          }
        }}
      >
        Delete card
      </button>
      <ErrorText>{error ? userMessage(error, 'card-controls') : null}</ErrorText>
    </section>
  )
}

function AmountSheet({
  action,
  card,
  merchant,
  onClose,
}: {
  action: Action
  card: CardWithBalance
  merchant: MerchantSummary
  onClose: () => void
}) {
  const record = useRecordTransaction()
  const setBalance = useSetBalance()
  const online = useOnline()
  const [amount, setAmount] = useState(action === 'set' ? centsToInput(card.balance_cents) : '')
  const [note, setNote] = useState('')
  const [localError, setLocalError] = useState('')
  const cents = parseMoneyToCents(amount)
  const pending = record.isPending || setBalance.isPending
  const serverError = record.error ?? setBalance.error

  const title = { spend: `Spent at ${merchant.name}`, load: 'Add funds', set: 'Set balance' }[action]

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLocalError('')
    try {
      if (action === 'spend') {
        const check = checkSpend(card.balance_cents, cents)
        if (!check.ok) {
          setLocalError(check.reason === 'exceeds_balance' ? `That's more than the ${formatCents(card.balance_cents)} balance.` : 'Enter an amount.')
          return
        }
        await record.mutateAsync({ cardId: card.id, type: 'spend', cents: cents!, note })
      } else if (action === 'load') {
        if (!checkLoad(cents).ok) {
          setLocalError('Enter an amount.')
          return
        }
        await record.mutateAsync({ cardId: card.id, type: 'load', cents: cents!, note })
      } else {
        if (cents === null) {
          setLocalError('Enter the balance shown by the merchant.')
          return
        }
        await setBalance.mutateAsync({ cardId: card.id, targetCents: cents, note: note || 'Balance checked' })
      }
      onClose()
    } catch {
      // rendered from mutation state
    }
  }

  const preview =
    cents === null
      ? null
      : action === 'spend'
        ? card.balance_cents - cents
        : action === 'load'
          ? card.balance_cents + cents
          : cents

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 pb-2">
        <MoneyInput
          label={action === 'set' ? 'Current balance on the card' : 'Amount'}
          value={amount}
          onChange={setAmount}
          autoFocus
          name="amount"
        />
        <div>
          <label htmlFor="note" className="label">
            Note (optional)
          </label>
          <input id="note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {preview !== null && preview >= 0 && (
          <p className="text-sm text-slate-600">
            New balance: <span className="font-semibold tabular-nums">{formatCents(preview)}</span>
            {action === 'set' && cents !== null && adjustDelta(card.balance_cents, cents) !== 0 && (
              <> (adjusts by {formatSignedCents(adjustDelta(card.balance_cents, cents))})</>
            )}
            {preview === 0 && ' · card will be archived'}
          </p>
        )}
        <ErrorText>{localError || (serverError ? userMessage(serverError, 'amount') : null)}</ErrorText>
        <button className="btn-primary w-full" disabled={!online || pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Sheet>
  )
}
