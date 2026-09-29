// Per-device preferences (localStorage). Never card data.

const OPEN_IN_BROWSER = 'wallet.openInBrowser'
const ORIGINAL_IMAGE = 'wallet.tillOriginalImage'

function read(key: string): Record<string, true> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function write(key: string, id: string, value: boolean): void {
  const all = read(key)
  if (value) all[id] = true
  else delete all[id]
  try {
    localStorage.setItem(key, JSON.stringify(all))
  } catch {
    // storage unavailable (private mode): the choice just isn't remembered
  }
}

/** Some merchant pages refuse to load inside the app (e.g. 403 from bot protection). */
export function opensInBrowser(merchantId: string): boolean {
  return read(OPEN_IN_BROWSER)[merchantId] === true
}

export function setOpensInBrowser(merchantId: string, value: boolean): void {
  write(OPEN_IN_BROWSER, merchantId, value)
}

/** Till mode shows the uploaded image instead of the redrawn barcode for this card. */
export function prefersOriginalImage(cardId: string): boolean {
  return read(ORIGINAL_IMAGE)[cardId] === true
}

export function setPrefersOriginalImage(cardId: string, value: boolean): void {
  write(ORIGINAL_IMAGE, cardId, value)
}
