import { describe, expect, it, vi } from 'vitest'
import { userMessage } from './errors'

describe('userMessage', () => {
  it('maps our raised codes', () => {
    expect(userMessage({ message: 'insufficient_balance', code: 'P0001' })).toBe("That's more than the card's balance.")
  })

  it('never echoes the server message, which can contain the card number', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = userMessage({
      code: '23514',
      message: 'new row violates check constraint',
      details: 'Failing row contains (6006491234567890, 1234)',
    })
    expect(msg).toBe('Something went wrong (ref 23514). Please try again.')
    expect(msg).not.toContain('6006491234567890')
    expect(msg).not.toContain('1234)')
  })

  it('identifies duplicate card numbers without showing them', () => {
    const msg = userMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "cards_unique_number"',
      details: 'Key (household_id, merchant_id, card_number)=(x, y, 6006491234567890) already exists.',
    })
    expect(msg).toBe('That card number is already saved for this merchant.')
  })

  it('reports network failures as offline', () => {
    expect(userMessage(new TypeError('Failed to fetch'))).toMatch(/offline/)
  })

  it('explains uploads refused for size', () => {
    expect(userMessage({ name: 'StorageApiError', message: 'The object exceeded the maximum allowed size', status: 413, statusCode: '413' })).toMatch(/too large/)
  })

  it('asks to sign in again when the session expired', () => {
    expect(userMessage({ code: 'PGRST301', message: 'JWT expired' })).toBe('Please sign in again.')
  })

  it('gives HTTP-status references for unknown failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(userMessage({ name: 'StorageApiError', message: 'boom', status: 500 })).toBe('Something went wrong (ref 500). Please try again.')
  })
})
