import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  useCard,
  useCreateCard,
  useMembers,
  useMerchants,
  useMyHousehold,
  useSignedImageUrl,
  useUpdateCard,
} from '../api/queries'
import { BARCODE_FORMATS, FORMAT_INFO, guessCardNumber, isBarcodeFormat, type BarcodeFormat } from '../lib/barcode/formats'
import { renderBarcode } from '../lib/barcode/render'
import { canvasImageData, canvasToPng, fileToCanvas } from '../lib/image'
import { parseMoneyToCents } from '../lib/money'
import { userMessage } from '../lib/errors'
import { logError } from '../lib/redact'
import { useOnline } from '../lib/queryClient'
import { ErrorText, Field, MoneyInput, Page, Sheet, Splash } from '../components/ui'
import { MerchantForm } from '../components/MerchantForm'
import type { CardWithBalance } from '../api/types'

type DecodeState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'found'; format: BarcodeFormat }
  | { status: 'none' }
  | { status: 'error' }

export function NewCard() {
  return <CardForm />
}

export function EditCard() {
  const { cardId } = useParams()
  const card = useCard(cardId)
  if (card.isPending) return <Splash />
  if (!card.data) return <Splash text="Card not found" />
  return <CardForm card={card.data} />
}

function CardForm({ card }: { card?: CardWithBalance }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const online = useOnline()
  const household = useMyHousehold()
  const merchants = useMerchants()
  const members = useMembers()
  const create = useCreateCard(household.data?.household.id)
  const update = useUpdateCard(card)

  const [merchantId, setMerchantId] = useState(card?.merchant_id ?? params.get('merchant') ?? '')
  const [label, setLabel] = useState(card?.label ?? '')
  const [cardNumber, setCardNumber] = useState(card?.card_number ?? '')
  const [pin, setPin] = useState(card?.pin ?? '')
  const [showPin, setShowPin] = useState(false)
  const [format, setFormat] = useState<BarcodeFormat | ''>(card?.barcode_format ?? '')
  const [barcodeValue, setBarcodeValue] = useState(card?.barcode_value ?? '')
  const [heldBy, setHeldBy] = useState(card?.held_by ?? '')
  const [opening, setOpening] = useState('')
  const [image, setImage] = useState<Blob | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [decode, setDecode] = useState<DecodeState>({ status: 'idle' })
  const [addingMerchant, setAddingMerchant] = useState(false)
  const [formError, setFormError] = useState('')

  const previewUrl = useMemo(() => (image ? URL.createObjectURL(image) : null), [image])
  useEffect(() => () => void (previewUrl && URL.revokeObjectURL(previewUrl)), [previewUrl])
  const existingImage = useSignedImageUrl(!image && !removeImage ? card?.barcode_image_path : null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setDecode({ status: 'working' })
    try {
      const canvas = await fileToCanvas(file)
      setImage(await canvasToPng(canvas))
      setRemoveImage(false)
      const { decodeBarcode } = await import('../lib/barcode/decode')
      const found = await decodeBarcode(canvasImageData(canvas))
      if (!found) {
        setDecode({ status: 'none' })
        return
      }
      setFormat(found.format)
      setBarcodeValue(found.value)
      const guess = guessCardNumber(found.value)
      if (guess && !cardNumber.trim()) setCardNumber(guess)
      setDecode({ status: 'found', format: found.format })
    } catch (err) {
      logError('decode', err)
      setDecode({ status: 'error' })
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!merchantId) return setFormError('Pick a merchant.')
    if (!cardNumber.trim()) return setFormError('Enter the card number.')
    const fmt = format === '' ? null : format
    const value = fmt ? (barcodeValue.trim() || cardNumber.trim()) : null
    if (fmt && value) {
      try {
        await renderBarcode(document.createElement('canvas'), fmt, value)
      } catch {
        return setFormError(`That barcode value isn't valid for ${FORMAT_INFO[fmt].label}. Check the format or value.`)
      }
    }
    const input = {
      merchantId,
      label,
      cardNumber: cardNumber.trim(),
      pin,
      barcodeFormat: fmt,
      barcodeValue: value,
      heldBy: heldBy || null,
      image,
      removeImage,
    }
    try {
      if (card) {
        await update.mutateAsync(input)
        navigate(`/c/${card.id}`, { replace: true })
      } else {
        const openingCents = opening.trim() === '' ? 0 : parseMoneyToCents(opening)
        if (openingCents === null) return setFormError('Enter a valid opening balance.')
        const id = await create.mutateAsync({ ...input, openingCents })
        navigate(`/c/${id}`, { replace: true })
      }
    } catch {
      // shown below
    }
  }

  const mutationError = create.error ?? update.error
  const pending = create.isPending || update.isPending
  const shownImage = previewUrl ?? existingImage.data ?? null

  return (
    <Page title={card ? 'Edit card' : 'Add card'} back={true}>
      <form onSubmit={submit} className="space-y-5 pb-8">
        <Field label="Merchant">
          {(id) => (
            <div className="flex gap-2">
              <select id={id} className="input" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} required>
                <option value="" disabled>
                  Choose…
                </option>
                {merchants.data?.map((m) => (
                  <option key={m.merchant_id} value={m.merchant_id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary shrink-0" disabled={!online} onClick={() => setAddingMerchant(true)}>
                New
              </button>
            </div>
          )}
        </Field>

        <div className="card space-y-3 p-4">
          <p className="font-semibold">Barcode</p>
          <p className="text-sm text-slate-600">Upload a screenshot, photo or PDF of the card. It's read on this device.</p>
          <label className="btn-secondary w-full cursor-pointer">
            {shownImage ? 'Replace image' : 'Upload image or PDF'}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              data-testid="barcode-upload"
              onChange={(e) => {
                void onFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          {decode.status === 'working' && <p className="text-sm text-slate-600">Reading barcode…</p>}
          {decode.status === 'found' && (
            <p className="text-sm text-emerald-700" data-testid="decode-found">
              Found a {FORMAT_INFO[decode.format].label} barcode. Check the number below.
            </p>
          )}
          {decode.status === 'none' && (
            <p className="text-sm text-amber-800">No barcode found. Enter the number manually; the image will be shown at the till.</p>
          )}
          {decode.status === 'error' && <p className="text-sm text-amber-800">Couldn't read that file. Try a screenshot instead.</p>}
          {shownImage && (
            <div className="space-y-2">
              <img src={shownImage} alt="Uploaded barcode" className="max-h-48 w-full rounded-lg border border-slate-200 object-contain" />
              <button
                type="button"
                className="text-sm text-slate-600 underline"
                onClick={() => {
                  setImage(null)
                  setRemoveImage(true)
                }}
              >
                Remove image
              </button>
            </div>
          )}
        </div>

        <Field label="Card number">
          {(id) => (
            <input
              id={id}
              name="card_number"
              className="input font-mono"
              required
              maxLength={64}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
            />
          )}
        </Field>

        <Field label="PIN (optional)">
          {(id) => (
            <div className="flex gap-2">
              <input
                id={id}
                name="pin"
                className="input font-mono"
                type={showPin ? 'text' : 'password'}
                maxLength={32}
                autoComplete="off"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
              <button type="button" className="btn-secondary shrink-0" onClick={() => setShowPin((s) => !s)}>
                {showPin ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
        </Field>

        <details className="card p-4" open={format !== '' && decode.status !== 'found' && Boolean(card)}>
          <summary className="cursor-pointer font-semibold">Barcode format (advanced)</summary>
          <div className="mt-3 space-y-3">
            <Field label="Format">
              {(id) => (
                <select
                  id={id}
                  name="barcode_format"
                  className="input"
                  value={format}
                  onChange={(e) => setFormat(isBarcodeFormat(e.target.value) ? e.target.value : '')}
                >
                  <option value="">None (show number / image only)</option>
                  {BARCODE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_INFO[f].label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {format && (
              <Field label="Barcode value" hint="Leave blank to use the card number.">
                {(id) => (
                  <input
                    id={id}
                    className="input font-mono"
                    maxLength={1024}
                    autoComplete="off"
                    spellCheck={false}
                    value={barcodeValue}
                    onChange={(e) => setBarcodeValue(e.target.value)}
                  />
                )}
              </Field>
            )}
          </div>
        </details>

        <Field label="Label (optional)" hint="e.g. “Birthday card from Mom”">
          {(id) => <input id={id} className="input" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>

        <Field label="Who has it?">
          {(id) => (
            <select id={id} className="input" value={heldBy} onChange={(e) => setHeldBy(e.target.value)}>
              <option value="">Nobody in particular</option>
              {members.data?.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          )}
        </Field>

        {!card && (
          <div>
            <MoneyInput label="Current balance" value={opening} onChange={setOpening} name="opening_balance" />
            <p className="mt-1 text-xs text-slate-500">A card added at $0.00 goes straight to Archived.</p>
          </div>
        )}

        <ErrorText>{formError || (mutationError ? userMessage(mutationError, 'save-card') : null)}</ErrorText>
        {!online && <ErrorText>You're offline. Reconnect to save.</ErrorText>}
        <button className="btn-primary w-full" disabled={!online || pending || decode.status === 'working'}>
          {pending ? 'Saving…' : card ? 'Save changes' : 'Add card'}
        </button>
      </form>

      {addingMerchant && (
        <Sheet title="New merchant" onClose={() => setAddingMerchant(false)}>
          <MerchantForm
            onDone={(id) => {
              if (id) setMerchantId(id)
              setAddingMerchant(false)
            }}
          />
        </Sheet>
      )}
    </Page>
  )
}
