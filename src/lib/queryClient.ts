import { QueryClient, onlineManager } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'
import { useSyncExternalStore } from 'react'

const DAY = 24 * 60 * 60 * 1000
export const CACHE_MAX_AGE = 30 * DAY
const CACHE_KEY = 'wallet-query-cache'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: CACHE_MAX_AGE,
      staleTime: 30_000,
      retry: (count) => onlineManager.isOnline() && count < 2,
      // Show cached data offline instead of pausing with nothing.
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Edits require connectivity: fail fast instead of queueing silently.
      networkMode: 'always',
      retry: false,
    },
  },
})

/**
 * Last-synced household data lives in IndexedDB on this device so it can be viewed
 * offline (including at the till). It is wiped on sign-out.
 */
export const persister = createAsyncStoragePersister({
  key: CACHE_KEY,
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value: string) => set(key, value),
    removeItem: (key) => del(key),
  },
  throttleTime: 1000,
})

export async function clearLocalData(): Promise<void> {
  queryClient.clear()
  await persister.removeClient()
  if ('caches' in window) await caches.delete('card-images')
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  )
}
