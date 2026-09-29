import { CheckError } from '../errors'
import type { BalanceFetcher } from './types'

/**
 * Indigo (indigo.ca/en-ca/giftcard-balance): card number + PIN.
 *
 * NOT IMPLEMENTED YET. The page's form, result markup and bot protection haven't been
 * inspected (the build environment couldn't reach indigo.ca), and guessing risks
 * recording a wrong balance. Until this is written against the real page, checks for
 * Indigo cards fail cleanly with 'not_supported' and nothing is recorded.
 */
export const indigoFetcher: BalanceFetcher = {
  provider: 'indigo',
  async fetch() {
    throw new CheckError('not_supported')
  },
}
