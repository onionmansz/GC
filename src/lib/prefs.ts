// Per-device preferences (localStorage). Never card data.

const KEY = 'wallet.openInBrowser'

function read(): Record<string, true> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Some merchant pages refuse to load inside the app (e.g. 403 from bot protection). */
export function opensInBrowser(merchantId: string): boolean {
  return read()[merchantId] === true
}

export function setOpensInBrowser(merchantId: string, value: boolean): void {
  const all = read()
  if (value) all[merchantId] = true
  else delete all[merchantId]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // storage unavailable (private mode): the choice just isn't remembered
  }
}
