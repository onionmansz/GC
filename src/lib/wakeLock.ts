import { useEffect, useState } from 'react'

/**
 * Keep the screen on while mounted (Screen Wake Lock API). The lock is released by
 * the browser whenever the page is hidden, so re-acquire it on return.
 * Returns whether a lock is currently held (false where unsupported).
 */
export function useWakeLock(): boolean {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    async function acquire() {
      if (document.visibilityState !== 'visible' || sentinel) return
      try {
        const s = await navigator.wakeLock.request('screen')
        if (cancelled) {
          await s.release()
          return
        }
        sentinel = s
        setHeld(true)
        s.addEventListener('release', () => {
          sentinel = null
          setHeld(false)
        })
      } catch {
        setHeld(false)
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void sentinel?.release()
    }
  }, [])

  return held
}
