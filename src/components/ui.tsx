import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useIsFetching } from '@tanstack/react-query'
import { useOnline } from '../lib/queryClient'
import { timeAgo } from '../lib/time'
import { maskCardNumber } from '../lib/redact'
import { copyText } from '../lib/clipboard'

export function Page({
  title,
  back,
  actions,
  children,
}: {
  title: ReactNode
  back?: string | true
  actions?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="pt-safe sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-4 pb-3 backdrop-blur">
        <div className="flex min-h-10 items-center gap-2">
          {back && (
            <button
              type="button"
              aria-label="Back"
              className="-ml-2 rounded-lg px-2 py-1 text-2xl leading-none text-slate-700"
              onClick={() => (back === true ? navigate(-1) : navigate(back))}
            >
              ‹
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-slate-900">{title}</h1>
          {actions}
        </div>
      </header>
      <OfflineBanner />
      <main className="pb-safe flex-1 px-4 pt-4">{children}</main>
    </div>
  )
}

export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      You're offline. Showing last-synced data; changes are disabled until you reconnect.
    </div>
  )
}

export function LastSynced({ updatedAt }: { updatedAt: number }) {
  const fetching = useIsFetching() > 0
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  if (!updatedAt) return null
  return (
    <p className="text-xs text-slate-500" data-testid="last-synced">
      {fetching ? 'Syncing…' : `Last synced ${timeAgo(updatedAt)}`}
    </p>
  )
}

/** PIN is always masked until tapped, and re-masks itself after 10 seconds. */
export function MaskedPin({ pin, className = '' }: { pin: string | null; className?: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setShown(false), 10_000)
    return () => clearTimeout(t)
  }, [shown])
  if (!pin) return <span className="text-slate-400">No PIN</span>
  return (
    <button
      type="button"
      className={`font-mono tracking-widest ${className}`}
      onClick={() => setShown((s) => !s)}
      aria-label={shown ? 'Hide PIN' : 'Show PIN'}
      data-testid="pin"
    >
      {shown ? pin : '•'.repeat(Math.max(4, pin.length))}
      <span className="ml-2 font-sans text-xs font-normal tracking-normal text-slate-500 underline">
        {shown ? 'hide' : 'tap to show'}
      </span>
    </button>
  )
}

/** Card number masked to the last four until tapped. */
export function MaskedNumber({ number }: { number: string }) {
  const [shown, setShown] = useState(false)
  return (
    <button type="button" className="font-mono text-slate-800" onClick={() => setShown((s) => !s)}>
      {shown ? number : maskCardNumber(number)}
    </button>
  )
}

export function MoneyInput({
  label,
  value,
  onChange,
  autoFocus,
  name,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  name?: string
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">$</span>
        <input
          id={id}
          name={name}
          className="input pl-7 text-lg tabular-nums"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  )
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="pb-safe w-full max-w-xl rounded-t-3xl bg-white px-4 pt-4 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" className="px-2 text-2xl leading-none text-slate-500" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Splash({ text = 'Loading…' }: { text?: string }) {
  return <div className="flex min-h-dvh items-center justify-center text-slate-500">{text}</div>
}

export function MerchantDot({ color }: { color: string }) {
  return <span className="inline-block size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
}

export function EmptyState({ children, action }: { children: ReactNode; action?: { to: string; label: string } }) {
  return (
    <div className="card p-6 text-center text-slate-600">
      <p>{children}</p>
      {action && (
        <Link to={action.to} className="btn-primary mt-4">
          {action.label}
        </Link>
      )}
    </div>
  )
}

/** Small "Copy" button; shows "Copied" briefly. The value is never displayed or logged. */
export function CopyButton({ value, what }: { value: string; what: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(t)
  }, [state])
  return (
    <button
      type="button"
      className="ml-2 rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 active:bg-slate-100"
      aria-label={`Copy ${what}`}
      data-testid={`copy-${what.replace(/\s+/g, '-').toLowerCase()}`}
      onClick={() => void copyText(value).then((ok) => setState(ok ? 'copied' : 'failed'))}
    >
      {state === 'copied' ? 'Copied ✓' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  )
}
