import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { onlineManager } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import { CACHE_MAX_AGE, persister, queryClient } from './lib/queryClient'
import { AuthProvider } from './auth/AuthProvider'
import { App } from './App'
import './index.css'

registerSW({
  immediate: true,
  // An installed app can sit in the background for days without checking for a new
  // version. Check whenever it comes back on screen, and hourly while open; a new
  // version activates and reloads the app automatically.
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
    setInterval(check, 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        buster: __APP_VERSION__,
        // Persist data, never in-flight or failed queries.
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === 'success' },
      }}
      onSuccess={() => {
        // The saved copy is for instant display (and offline). It can lag the server by
        // a moment (saves are throttled) or by days (an installed app left in the
        // background), so refresh everything as soon as it's restored.
        if (onlineManager.isOnline()) void queryClient.invalidateQueries()
        void queryClient.resumePausedMutations()
      }}
    >
      <AuthProvider>
        <App />
      </AuthProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
