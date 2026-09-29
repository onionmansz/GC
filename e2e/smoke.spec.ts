import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { toBuffer } from 'bwip-js/node'
import { randomUUID } from 'node:crypto'

const url = process.env.SUPABASE_TEST_URL
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

const CARD_NUMBER = '6006491234567890'
const PIN = '4321'

test.skip(!url || !anonKey || !serviceKey, 'Set SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY (dev or local stack only)')

let admin: SupabaseClient
let userId: string
const email = `e2e-${randomUUID().slice(0, 8)}@example.com`

test.beforeAll(async () => {
  admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw error
  userId = data.user.id
})

test.afterAll(async () => {
  if (!admin || !userId) return
  const { data } = await admin.from('household_members').select('household_id').eq('user_id', userId)
  const householdIds = (data ?? []).map((r) => r.household_id as string)
  for (const hid of householdIds) {
    const { data: files } = await admin.storage.from('card-images').list(hid)
    if (files?.length) await admin.storage.from('card-images').remove(files.map((f) => `${hid}/${f.name}`))
  }
  if (householdIds.length) await admin.from('households').delete().in('id', householdIds)
  await admin.auth.admin.deleteUser(userId)
})

test('add card → spend → balance updates → show-at-till renders barcode', async ({ page }) => {
  const consoleText: string[] = []
  page.on('console', (m) => consoleText.push(m.text()))
  const visited: string[] = []
  page.on('framenavigated', (f) => f === page.mainFrame() && visited.push(f.url()))

  // Sign in with a real magic-link token (generated server-side, no email needed).
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  await page.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=magiclink`)

  // First run: create the household (seeds Indigo, Esso, Tim Hortons).
  await page.getByLabel('Your name').fill('E2E')
  await page.getByRole('button', { name: 'Create a new household' }).click()
  await page.getByRole('button', { name: 'Create household' }).click()
  await expect(page.getByTestId('grand-total')).toHaveText('$0.00')

  // Add a card from an uploaded barcode screenshot; decoding pre-fills the number.
  await page.getByRole('link', { name: 'Add your first card' }).click()
  await page.getByLabel('Merchant').selectOption({ label: 'Indigo' })
  const png = await toBuffer({ bcid: 'code128', text: CARD_NUMBER, scale: 3, height: 15, includetext: true, paddingwidth: 20, paddingheight: 20, backgroundcolor: 'FFFFFF' })
  await page.getByTestId('barcode-upload').setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByTestId('decode-found')).toContainText('Code 128')
  await expect(page.getByLabel('Card number')).toHaveValue(CARD_NUMBER)
  await page.getByLabel('PIN (optional)').fill(PIN)
  await page.getByLabel('Current balance').fill('50.00')
  await page.getByRole('button', { name: 'Add card' }).click()

  await expect(page.getByTestId('card-balance')).toHaveText('$50.00')
  await expect(page.getByTestId('pin')).not.toContainText(PIN)

  // Spend and watch the balance update.
  await page.getByRole('button', { name: 'Spent $' }).click()
  await page.getByLabel('Amount').fill('12.34')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('card-balance')).toHaveText('$37.66')
  await expect(page.getByTestId('ledger')).toContainText('Spent')
  await expect(page.getByTestId('ledger')).toContainText('−$12.34')

  // Show at till: barcode rendered from the decoded value, number in large text, PIN masked.
  await page.getByTestId('show-at-till').click()
  await expect(page.getByTestId('till-mode')).toBeVisible()
  await expect(page.getByTestId('barcode-canvas')).toHaveAttribute('data-rendered', 'true')
  await expect(page.getByTestId('till-card-number')).toHaveText('6006 4912 3456 7890')
  const pin = page.getByTestId('till-mode').getByTestId('pin')
  await expect(pin).not.toContainText(PIN)
  await pin.click()
  await expect(pin).toContainText(PIN)

  // The canvas really contains a barcode (dark bars on white), not a blank box.
  const darkRatio = await page.getByTestId('barcode-canvas').evaluate((el) => {
    const c = el as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 64) dark++
    return dark / (d.length / 4)
  })
  expect(darkRatio).toBeGreaterThan(0.2)
  expect(darkRatio).toBeLessThan(0.8)

  // Secrets never appear in URLs or console output.
  for (const u of [...visited, page.url()]) {
    expect(u).not.toContain(CARD_NUMBER)
    expect(u).not.toContain(PIN)
  }
  expect(consoleText.join('\n')).not.toContain(CARD_NUMBER)
})
