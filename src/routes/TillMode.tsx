import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useCard, useMerchants, useSignedImageUrl } from '../api/queries'
import { renderBarcode } from '../lib/barcode/render'
import { formatCents } from '../lib/money'
import { groupCardNumber } from '../lib/redact'
import { useWakeLock } from '../lib/wakeLock'
import { MaskedPin, Splash } from '../components/ui'
import type { CardWithBalance } from '../api/types'

/** Full-screen, white, scanner-friendly view. Keeps the screen awake while open. */
export function TillMode() {
  const { cardId } = useParams()
  const card = useCard(cardId)
  const merchants = useMerchants()
  const navigate = useNavigate()
  const awake = useWakeLock()

  useEffect(() => {
    const prev = document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#ffffff')
    return () => {
      if (prev) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', prev)
    }
  }, [])

  if (card.isPending) return <Splash />
  if (!card.data) return <Splash text="Card not found" />
  const c = card.data
  const merchant = merchants.data?.find((m) => m.merchant_id === c.merchant_id)

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-white text-black" data-testid="till-mode">
      <div className="pt-safe flex items-center justify-between px-4">
        <p className="text-lg font-semibold">{merchant?.name}</p>
        <button
          type="button"
          className="rounded-full bg-slate-100 px-4 py-2 text-base font-semibold"
          onClick={() => navigate(`/c/${c.id}`, { replace: true })}
        >
          Done
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6">
        <Barcode card={c} />
        <p className="text-center font-mono text-[clamp(1.25rem,7.2vw,2.5rem)] font-bold tracking-wider" data-testid="till-card-number">
          {groupCardNumber(c.card_number)}
        </p>
        {c.pin && (
          <div className="text-center">
            <p className="text-sm text-slate-500">PIN</p>
            <MaskedPin pin={c.pin} className="text-3xl font-bold" />
          </div>
        )}
        <p className="text-slate-500">Balance {formatCents(c.balance_cents)}</p>
      </div>

      <p className="pb-safe px-4 text-center text-xs text-slate-400">
        {awake ? 'Screen will stay on while this is open.' : 'Tip: turn up your screen brightness for scanning.'}
      </p>
    </div>
  )
}

function Barcode({ card }: { card: CardWithBalance }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderFailed, setRenderFailed] = useState(false)
  const canRender = Boolean(card.barcode_format && card.barcode_value) && !renderFailed
  const image = useSignedImageUrl(canRender ? null : card.barcode_image_path)

  useEffect(() => {
    if (!canvasRef.current || !card.barcode_format || !card.barcode_value) return
    renderBarcode(canvasRef.current, card.barcode_format, card.barcode_value).then(
      () => canvasRef.current?.setAttribute('data-rendered', 'true'),
      () => setRenderFailed(true),
    )
  }, [card.barcode_format, card.barcode_value])

  if (canRender) {
    return (
      <canvas
        ref={canvasRef}
        className="h-auto max-h-[45vh] w-full max-w-[640px] object-contain [image-rendering:pixelated]"
        data-testid="barcode-canvas"
        aria-label="Barcode"
      />
    )
  }
  if (card.barcode_image_path) {
    return image.data ? (
      <img src={image.data} alt="Original barcode" className="max-h-[50vh] w-full max-w-[640px] object-contain" data-testid="barcode-image" />
    ) : (
      <p className="text-slate-500">{image.isError ? 'Barcode image unavailable offline.' : 'Loading barcode…'}</p>
    )
  }
  return <p className="text-center text-slate-500">No barcode saved. Read the number to the cashier.</p>
}
