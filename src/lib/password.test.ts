import { describe, expect, it } from 'vitest'
import { checkNewPassword } from './password'

describe('checkNewPassword', () => {
  it('requires a minimum length', () => {
    expect(checkNewPassword('short', 'short')).toMatch(/at least 10/)
  })
  it('requires matching confirmation', () => {
    expect(checkNewPassword('long enough pw', 'long enough pX')).toMatch(/don't match/)
  })
  it('rejects leading/trailing spaces', () => {
    expect(checkNewPassword(' long enough pw', ' long enough pw')).toMatch(/space/)
  })
  it('accepts a good password', () => {
    expect(checkNewPassword('correct horse battery', 'correct horse battery')).toBeNull()
  })
})
