// Turn an uploaded screenshot, photo or PDF into a canvas: used both for decoding
// and as the stored fallback image. Re-encoding to PNG strips EXIF (location, etc.).

const MAX_EDGE = 2000

export async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const { renderPdfFirstPage } = await import('./pdf')
    return renderPdfFirstPage(file)
  }
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas_unavailable')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    bitmap.close()
  }
}

export function canvasImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas_unavailable')
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/** Storage accepts up to 5 MB per image; stay well under it. */
export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode_failed'))), type, quality),
  )
}

/**
 * Encode for upload as JPEG (photos as PNG can exceed the 5 MB storage limit), shrinking
 * until it fits. Quality 0.9 keeps barcodes crisp; re-encoding also drops EXIF.
 */
export async function canvasToUploadImage(canvas: HTMLCanvasElement, maxBytes = MAX_UPLOAD_BYTES): Promise<Blob> {
  let source = canvas
  for (let attempt = 0; attempt < 4; attempt++) {
    const blob = await toBlob(source, 'image/jpeg', 0.9)
    if (blob.size <= maxBytes) return blob
    const smaller = document.createElement('canvas')
    smaller.width = Math.round(source.width * 0.75)
    smaller.height = Math.round(source.height * 0.75)
    smaller.getContext('2d')?.drawImage(source, 0, 0, smaller.width, smaller.height)
    source = smaller
  }
  return toBlob(source, 'image/jpeg', 0.8)
}
