import { describe, expect, it } from 'vitest'
import { CACHE_MAX_AGE, queryClient } from './queryClient'

describe('offline cache lifetime', () => {
  it('keeps gcTime within setTimeout range so restored queries are not collected immediately', () => {
    const MAX_TIMEOUT = 2 ** 31 - 1
    expect(CACHE_MAX_AGE).toBeLessThanOrEqual(MAX_TIMEOUT)
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBeLessThanOrEqual(MAX_TIMEOUT)
  })
})
