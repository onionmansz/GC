import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { registerSW } from 'virtual:pwa-register'
import { CACHE_MAX_AGE, persister, queryClient } from './lib/queryClient'
import { AuthProvider } from './auth/AuthProvider'
import { App } from './App'
import './index.css'

registerSW({ immediate: true })

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
      onSuccess={() => void queryClient.resumePausedMutations()}
    >
      <AuthProvider>
        <App />
      </AuthProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
