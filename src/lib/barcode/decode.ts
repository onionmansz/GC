import type { ReadResult } from 'zxing-wasm/reader'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { fromZxingFormat, type BarcodeFormat } from './formats'

export interface DecodedBarcode {
  format: BarcodeFormat
  value: string
}

let prepared: Promise<typeof import('zxing-wasm/reader')> | null = null

/** Lazily load the decoder, serving the WASM from our own origin (never a CDN). */
function loadReader() {
  prepared ??= import('zxing-wasm/reader').then((mod) => {
    mod.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
      },
    })
    return mod
  })
  return prepared
}

/**
 * Decode barcodes from an image, entirely on the device. Returns the first result we
 * can re-render, preferring the largest symbol when a screenshot contains several.
 */
export async function decodeBarcode(image: ImageData): Promise<DecodedBarcode | null> {
  const { readBarcodes } = await loadReader()
  const results: ReadResult[] = await readBarcodes(image, {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 8,
  })
  const usable = results
    .filter((r) => r.isValid && r.text)
    .map((r) => ({ r, format: fromZxingFormat(r.format) }))
    .filter((x): x is { r: ReadResult; format: BarcodeFormat } => x.format !== null)
    .sort((a, b) => area(b.r) - area(a.r))
  const best = usable[0]
  return best ? { format: best.format, value: best.r.text } : null
}

function area(r: ReadResult): number {
  const { topLeft: a, bottomRight: c } = r.position
  return Math.abs((c.x - a.x) * (c.y - a.y))
}
