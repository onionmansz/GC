// One table maps our stored format (cards.barcode_format) to the zxing decoder's
// names and the bwip-js encoder id. Keep in sync with the check constraint in
// supabase/migrations/*_schema.sql.

export const BARCODE_FORMATS = [
  'code128',
  'code39',
  'code93',
  'codabar',
  'ean13',
  'ean8',
  'upca',
  'upce',
  'itf',
  'pdf417',
  'qrcode',
  'datamatrix',
  'aztec',
] as const

export type BarcodeFormat = (typeof BARCODE_FORMATS)[number]

interface FormatInfo {
  label: string
  /** bwip-js encoder id. */
  bcid: string
  /** zxing-wasm output format names that map to this format. */
  zxing: readonly string[]
  /** 2D codes render square; linear codes render wide. */
  twoD: boolean
}

export const FORMAT_INFO: Record<BarcodeFormat, FormatInfo> = {
  code128: { label: 'Code 128', bcid: 'code128', zxing: ['Code128'], twoD: false },
  code39: { label: 'Code 39', bcid: 'code39', zxing: ['Code39', 'Code39Std', 'Code39Ext'], twoD: false },
  code93: { label: 'Code 93', bcid: 'code93', zxing: ['Code93'], twoD: false },
  codabar: { label: 'Codabar', bcid: 'rationalizedCodabar', zxing: ['Codabar'], twoD: false },
  ean13: { label: 'EAN-13', bcid: 'ean13', zxing: ['EAN13', 'ISBN'], twoD: false },
  ean8: { label: 'EAN-8', bcid: 'ean8', zxing: ['EAN8'], twoD: false },
  upca: { label: 'UPC-A', bcid: 'upca', zxing: ['UPCA'], twoD: false },
  upce: { label: 'UPC-E', bcid: 'upce', zxing: ['UPCE'], twoD: false },
  itf: { label: 'ITF (Interleaved 2 of 5)', bcid: 'interleaved2of5', zxing: ['ITF', 'ITF14'], twoD: false },
  pdf417: { label: 'PDF417', bcid: 'pdf417', zxing: ['PDF417', 'CompactPDF417'], twoD: true },
  qrcode: { label: 'QR Code', bcid: 'qrcode', zxing: ['QRCode', 'QRCodeModel2', 'QRCodeModel1'], twoD: true },
  datamatrix: { label: 'Data Matrix', bcid: 'datamatrix', zxing: ['DataMatrix'], twoD: true },
  aztec: { label: 'Aztec', bcid: 'azteccode', zxing: ['Aztec', 'AztecCode'], twoD: true },
}

/** zxing output format → our format, or null if we can't re-render it. */
export function fromZxingFormat(zxingFormat: string): BarcodeFormat | null {
  for (const f of BARCODE_FORMATS) {
    if (FORMAT_INFO[f].zxing.includes(zxingFormat)) return f
  }
  return null
}

export function isBarcodeFormat(value: unknown): value is BarcodeFormat {
  return typeof value === 'string' && (BARCODE_FORMATS as readonly string[]).includes(value)
}

/**
 * Best guess at the printed card number from a decoded barcode value. Linear
 * barcodes usually encode the card number itself; 2D codes often carry extra
 * data, so we only prefill when the payload is a plain digit/letter string.
 */
export function guessCardNumber(value: string): string | null {
  const trimmed = value.trim()
  return /^[0-9A-Za-z-]{4,64}$/.test(trimmed) ? trimmed.replaceAll('-', '') : null
}
