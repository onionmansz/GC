import { FORMAT_INFO, type BarcodeFormat } from './formats'

/**
 * Draw a barcode onto `canvas`, black on white with a quiet zone, sized for a phone
 * screen held up to a scanner. Throws if the value is invalid for the format
 * (e.g. a bad EAN-13 check digit); callers fall back to the uploaded image.
 */
export async function renderBarcode(canvas: HTMLCanvasElement, format: BarcodeFormat, value: string): Promise<void> {
  // bwip-js is ~1 MB; load it only when a barcode is actually drawn (precached for offline).
  const { toCanvas } = await import('bwip-js/browser')
  const info = FORMAT_INFO[format]
  toCanvas(canvas, {
    bcid: info.bcid,
    text: value,
    scale: 4,
    // Linear codes: tall bars are easier for handheld scanners. Height is in mm.
    ...(info.twoD ? {} : { height: 22 }),
    includetext: false,
    paddingwidth: 10,
    paddingheight: 6,
    backgroundcolor: 'FFFFFF',
    barcolor: '000000',
  })
}
