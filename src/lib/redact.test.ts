import { afterEach, describe, expect, it, vi } from 'vitest'
import { groupCardNumber, logError, maskCardNumber, redact } from './redact'

describe('redact', () => {
  it('masks card numbers and PINs in free text', () => {
    expect(redact('card 6006491234567890 pin 1234')).toBe('card [redacted] pin [redacted]')
    expect(redact('6006 4912 3456 7890')).toBe('[redacted]')
    expect(redact('6006-4912-3456')).toBe('[redacted]')
  })
  it('leaves short numbers alone', () => {
    expect(redact('HTTP 500 after 3 tries')).toBe('HTTP 500 after 3 tries')
  })
})

describe('maskCardNumber', () => {
  it('shows only the last four', () => {
    expect(maskCardNumber('6006491234567890')).toBe('•••• 7890')
    expect(maskCardNumber('123')).toBe('••••')
  })
})

describe('groupCardNumber', () => {
  it('groups in fours', () => {
    expect(groupCardNumber('6006491234567890')).toBe('6006 4912 3456 7890')
    expect(groupCardNumber('123456')).toBe('1234 56')
  })
})

describe('logError', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs only a code, never the message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('spend', Object.assign(new Error('Key (card_number)=(6006491234567890) already exists'), { code: '23505' }))
    expect(spy).toHaveBeenCalledWith('[spend] 23505')
  })
})
