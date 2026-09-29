import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { EmailOtpType } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { Splash } from '../components/ui'
import { logError } from '../lib/redact'

/**
 * Token-hash sign-in link: /auth/confirm?token_hash=…&type=magiclink.
 * Used if the Supabase email template is switched to token_hash links (recommended;
 * works when the link is opened in a different browser than the one that asked).
 * The default template's redirect-with-fragment links are handled by supabase-js.
 */
export function AuthConfirm() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const tokenHash = params.get('token_hash')
    const type = (params.get('type') ?? 'magiclink') as EmailOtpType
    if (!tokenHash) {
      navigate('/', { replace: true })
      return
    }
    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
      if (error) {
        logError('auth-confirm', error)
        setFailed(true)
        return
      }
      // Drop the token from the address bar and history.
      navigate('/', { replace: true })
    })
  }, [params, navigate])

  if (failed) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6 text-center">
        <p className="font-semibold">This sign-in link has expired or was already used.</p>
        <button type="button" className="btn-primary" onClick={() => navigate('/', { replace: true })}>
          Request a new link
        </button>
      </div>
    )
  }
  return <Splash text="Signing you in…" />
}
