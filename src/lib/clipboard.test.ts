import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

describe('copyText', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('6006491234567890')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('6006491234567890')
  })

  it('falls back to a hidden textarea and reports failure honestly', async () => {
    vi.stubGlobal('navigator', {})
    const exec = vi.fn().mockReturnValue(true)
    document.execCommand = exec
    expect(await copyText('1234')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()

    exec.mockReturnValue(false)
    expect(await copyText('1234')).toBe(false)
  })
})
