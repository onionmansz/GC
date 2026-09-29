import { describe, expect, it } from 'vitest'
import { checkFailureMessage, isActiveCheck, isAutoCheckProvider, isStalePending } from './autoCheck'

describe('auto-check helpers', () => {
  it('knows its providers', () => {
    expect(isAutoCheckProvider('indigo')).toBe(true)
    expect(isAutoCheckProvider('esso')).toBe(false)
    expect(isAutoCheckProvider('toString')).toBe(false)
    expect(isAutoCheckProvider('sportchek')).toBe(true)
  })

  it('treats a check waiting for a person as still in progress', () => {
    expect(isActiveCheck('pending')).toBe(true)
    expect(isActiveCheck('running')).toBe(true)
    expect(isActiveCheck('awaiting_user')).toBe(true)
    expect(isActiveCheck('done')).toBe(false)
    expect(isActiveCheck('failed')).toBe(false)
    expect(isActiveCheck(undefined)).toBe(false)
  })

  it('maps failure codes to fixed text', () => {
    expect(checkFailureMessage('captcha')).toMatch(/CAPTCHA/)
    expect(checkFailureMessage('relink_needed')).toMatch(/link-indigo/)
    expect(checkFailureMessage('missing_pin')).toMatch(/PIN/)
    expect(checkFailureMessage('no_viewer')).toMatch(/VIEWER_PUBLIC_URL/)
    expect(checkFailureMessage('something_new')).toMatch(/failed/)
    expect(checkFailureMessage(null)).toMatch(/failed/)
  })

  it('flags requests nobody picked up', () => {
    const now = Date.parse('2026-10-01T12:00:00Z')
    expect(isStalePending('pending', '2026-10-01T11:59:30Z', now)).toBe(false)
    expect(isStalePending('pending', '2026-10-01T11:58:00Z', now)).toBe(true)
    expect(isStalePending('running', '2026-10-01T11:58:00Z', now)).toBe(false)
  })
})
