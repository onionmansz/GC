import { useEffect, useState } from 'react'
import { CopyButton, MaskedNumber, MaskedPin } from './ui'
import { useOnline } from '../lib/queryClient'
import { opensInBrowser, setOpensInBrowser } from '../lib/prefs'

/**
 * The merchant's balance-check page shown inside the app (full-screen panel), with the
 * card number and PIN one tap away and "Set balance" at the bottom. Some merchant pages
 * refuse to load inside another site, so "Open in browser" is always offered.
 */
export function BalanceCheckPanel({
  merchantId,
  merchantName,
  url,
  cardNumber,
  pin,
  onClose,
  onSetBalance,
}: {
  merchantId: string
  merchantName: string
  url: string
  cardNumber: string
  pin: string | null
  onClose: () => void
  onSetBalance: () => void
}) {
  const online = useOnline()
  const [loaded, setLoaded] = useState(false)
  const [alwaysBrowser, setAlwaysBrowser] = useState(() => opensInBrowser(merchantId))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    // Keep the app underneath from scrolling while the panel is open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={`${merchantName} balance check`} data-testid="balance-check-panel">
      <div className="pt-safe border-b border-slate-200 px-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-semibold">{merchantName} balance</p>
          <button type="button" className="rounded-full bg-slate-100 px-4 py-1.5 text-sm font-semibold" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center">
            <span className="mr-1 text-slate-500">Number</span>
            <MaskedNumber number={cardNumber} />
            <CopyButton value={cardNumber.replace(/\s+/g, '')} what="card number" />
          </span>
          {pin && (
            <span className="flex items-center">
              <span className="mr-1 text-slate-500">PIN</span>
              <MaskedPin pin={pin} />
              <CopyButton value={pin} what="PIN" />
            </span>
          )}
        </div>
      </div>

      <div className="relative flex-1">
        {online ? (
          <>
            {!loaded && <p className="absolute inset-x-0 top-8 text-center text-sm text-slate-500">Loading {merchantName}'s page…</p>}
            <iframe
              title={`${merchantName} balance check page`}
              src={url}
              className="absolute inset-0 h-full w-full border-0"
              // Default referrer policy: the merchant sees only this app's address (no path).
              // Hiding it entirely may look more suspicious to some bot-protection systems.
              // Enough for the merchant's form and its "I'm not a robot" check, nothing more.
              sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              onLoad={() => setLoaded(true)}
              data-testid="balance-check-frame"
            />
          </>
        ) : (
          <p className="p-6 text-center text-sm text-amber-800">You're offline. Reconnect to check the balance.</p>
        )}
      </div>

      <div className="pb-safe border-t border-slate-200 px-3 pt-2">
        <button type="button" className="btn-primary w-full" disabled={!online} onClick={onSetBalance}>
          Set balance
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          Blank, “403 Forbidden” or not working?{' '}
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
            Open in browser ↗
          </a>
        </p>
        <label className="mt-1 flex items-center justify-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={alwaysBrowser}
            onChange={(e) => {
              setAlwaysBrowser(e.target.checked)
              setOpensInBrowser(merchantId, e.target.checked)
            }}
          />
          Always open {merchantName} in the browser on this device
        </label>
      </div>
    </div>
  )
}
