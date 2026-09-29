import { beforeEach, describe, expect, it } from 'vitest'
import { opensInBrowser, prefersOriginalImage, setOpensInBrowser, setPrefersOriginalImage } from './prefs'

describe('open-in-browser preference', () => {
  beforeEach(() => localStorage.clear())

  it('is off by default and remembered per merchant', () => {
    expect(opensInBrowser('m1')).toBe(false)
    setOpensInBrowser('m1', true)
    expect(opensInBrowser('m1')).toBe(true)
    expect(opensInBrowser('m2')).toBe(false)
    setOpensInBrowser('m1', false)
    expect(opensInBrowser('m1')).toBe(false)
  })

  it('survives corrupted storage', () => {
    localStorage.setItem('wallet.openInBrowser', '{not json')
    expect(opensInBrowser('m1')).toBe(false)
    setOpensInBrowser('m1', true)
    expect(opensInBrowser('m1')).toBe(true)
  })

  it('remembers the till image choice per card, separately', () => {
    setPrefersOriginalImage('c1', true)
    expect(prefersOriginalImage('c1')).toBe(true)
    expect(prefersOriginalImage('c2')).toBe(false)
    expect(opensInBrowser('c1')).toBe(false)
  })
})
