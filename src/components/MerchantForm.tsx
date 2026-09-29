import { useState, type FormEvent } from 'react'
import { useCreateMerchant, useDeleteMerchant, useMyHousehold, useUpdateMerchant } from '../api/queries'
import type { MerchantSummary } from '../api/types'
import { userMessage } from '../lib/errors'
import { useOnline } from '../lib/queryClient'
import { ErrorText, Field } from './ui'
import { AUTO_CHECK_PROVIDERS, isAutoCheckProvider, type AutoCheckProvider } from '../lib/autoCheck'

export const CATEGORY_SUGGESTIONS = ['Books', 'Coffee', 'Gas', 'Groceries', 'Restaurants', 'Retail', 'Entertainment', 'Other']

export function MerchantForm({
  merchant,
  onDone,
}: {
  merchant?: MerchantSummary
  onDone: (merchantId: string | null) => void
}) {
  const household = useMyHousehold()
  const create = useCreateMerchant(household.data?.household.id)
  const update = useUpdateMerchant()
  const remove = useDeleteMerchant()
  const online = useOnline()
  const [name, setName] = useState(merchant?.name ?? '')
  const [category, setCategory] = useState(merchant?.category ?? '')
  const [color, setColor] = useState(merchant?.color ?? '#64748b')
  const [url, setUrl] = useState(merchant?.balance_check_url ?? '')
  const [autoCheck, setAutoCheck] = useState<AutoCheckProvider | ''>(merchant?.auto_check ?? '')
  const [urlError, setUrlError] = useState('')

  const pending = create.isPending || update.isPending || remove.isPending
  const error = create.error ?? update.error ?? remove.error

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (trimmed && !/^https:\/\/[^\s]+$/i.test(trimmed)) {
      setUrlError('Must start with https://')
      return
    }
    if (autoCheck === 'assisted' && !trimmed) {
      setUrlError('Assisted checks open the balance check page: add it above.')
      return
    }
    setUrlError('')
    const input = { name, category, color, balanceCheckUrl: trimmed, autoCheck: autoCheck || null }
    try {
      if (merchant) {
        await update.mutateAsync({ id: merchant.merchant_id, ...input })
        onDone(merchant.merchant_id)
      } else {
        onDone(await create.mutateAsync(input))
      }
    } catch {
      // shown via the mutation's error state
    }
  }

  async function del() {
    if (!merchant || !confirm(`Delete ${merchant.name}?`)) return
    await remove.mutateAsync(merchant.merchant_id).then(() => onDone(null), () => null)
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-2">
      <Field label="Name">
        {(id) => <input id={id} className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="Category">
        {(id) => (
          <>
            <input
              id={id}
              className="input"
              list="category-suggestions"
              required
              maxLength={40}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <datalist id="category-suggestions">
              {CATEGORY_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <Field label="Colour">
        {(id) => <input id={id} type="color" className="h-12 w-20 rounded-lg border border-slate-300" value={color} onChange={(e) => setColor(e.target.value)} />}
      </Field>
      <Field label="Balance check page (optional)" hint="Used by “Check balance”: opens this page inside the app, with Copy buttons for the number and PIN.">
        {(id) => (
          <input
            id={id}
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Automatic balance check"
        hint="Adds a “Check now” button to this merchant’s cards. Needs the checker running on your server (see README)."
      >
        {(id) => (
          <select
            id={id}
            className="input"
            value={autoCheck}
            onChange={(e) => setAutoCheck(isAutoCheckProvider(e.target.value) ? e.target.value : '')}
          >
            <option value="">Off</option>
            {Object.entries(AUTO_CHECK_PROVIDERS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <ErrorText>{urlError || (error ? userMessage(error, 'merchant') : null)}</ErrorText>
      <button className="btn-primary w-full" disabled={!online || pending}>
        {merchant ? 'Save merchant' : 'Add merchant'}
      </button>
      {merchant && merchant.active_card_count === 0 && (
        <button type="button" className="btn-danger w-full" disabled={!online || pending} onClick={del}>
          Delete merchant
        </button>
      )}
    </form>
  )
}
