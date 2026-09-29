import { describe, expect, it } from 'vitest'
import { BARCODE_FORMATS, FORMAT_INFO, fromZxingFormat, guessCardNumber, isBarcodeFormat } from './formats'

describe('barcode format mapping', () => {
  it('maps zxing names to stored formats', () => {
    expect(fromZxingFormat('Code128')).toBe('code128')
    expect(fromZxingFormat('PDF417')).toBe('pdf417')
    expect(fromZxingFormat('QRCode')).toBe('qrcode')
    expect(fromZxingFormat('EAN13')).toBe('ean13')
    expect(fromZxingFormat('ITF14')).toBe('itf')
    expect(fromZxingFormat('MaxiCode')).toBeNull()
  })

  it('has a bwip-js encoder for every stored format', () => {
    for (const f of BARCODE_FORMATS) expect(FORMAT_INFO[f].bcid).toMatch(/^\w+$/)
  })

  it('validates stored values', () => {
    expect(isBarcodeFormat('code128')).toBe(true)
    expect(isBarcodeFormat('Code128')).toBe(false)
    expect(isBarcodeFormat(null)).toBe(false)
  })
})

describe('guessCardNumber', () => {
  it('prefills plain numeric payloads', () => {
    expect(guessCardNumber(' 6006491234567890 ')).toBe('6006491234567890')
    expect(guessCardNumber('6006-4912-3456')).toBe('600649123456')
  })
  it('does not guess from structured payloads', () => {
    expect(guessCardNumber('https://example.com/card?id=1')).toBeNull()
    expect(guessCardNumber('123')).toBeNull()
  })
})
