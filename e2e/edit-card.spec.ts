import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { toBuffer } from 'bwip-js/node'
import { randomUUID } from 'node:crypto'
import { signInFresh } from './helpers'

const url = process.env.SUPABASE_TEST_URL
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

test.skip(!url || !anonKey || !serviceKey, 'Set SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY (dev or local stack only)')

let admin: SupabaseClient
let userId: string
const email = `e2e-edit-${randomUUID().slice(0, 8)}@example.com`

test.beforeAll(() => {
  admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterAll(async () => {
  if (!admin || !userId) return
  const { data } = await admin.from('household_members').select('household_id').eq('user_id', userId)
  for (const { household_id } of data ?? []) {
    const { data: files } = await admin.storage.from('card-images').list(household_id)
    if (files?.length) await admin.storage.from('card-images').remove(files.map((f) => `${household_id}/${f.name}`))
    await admin.from('households').delete().eq('id', household_id)
  }
  await admin.auth.admin.deleteUser(userId)
})

test('edit a card: fix the auto-filled number and replace the image with a large photo', async ({ page }) => {
  userId = await signInFresh(page, admin, email)

  // Barcode value differs from the number printed on the card (as with some merchants).
  await page.getByRole('link', { name: 'Add your first card' }).click()
  await page.getByLabel('Merchant').selectOption({ label: 'Indigo' })
  const barcode = await toBuffer({ bcid: 'code128', text: '9990001112223334445', scale: 3, height: 15, paddingwidth: 20, paddingheight: 20, backgroundcolor: 'FFFFFF' })
  await page.getByTestId('barcode-upload').setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: barcode })
  await expect(page.getByLabel('Card number')).toHaveValue('9990001112223334445')
  await page.getByLabel('Current balance').fill('25')
  await page.getByRole('button', { name: 'Add card' }).click()
  await expect(page.getByTestId('card-balance')).toHaveText('$25.00')

  // A detailed ~12-megapixel "photo": several MB even as a compressed PNG.
  const photoBase64 = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 4000
    c.height = 3000
    const x = c.getContext('2d')!
    const img = x.createImageData(c.width, c.height)
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = Math.random() * 255
      img.data[i + 1] = Math.random() * 255
      img.data[i + 2] = Math.random() * 255
      img.data[i + 3] = 255
    }
    x.putImageData(img, 0, 0)
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'))
    const buf = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return btoa(s)
  })
  const photo = Buffer.from(photoBase64, 'base64')
  expect(photo.length).toBeGreaterThan(5 * 1024 * 1024) // bigger than the storage limit as-is

  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByTestId('barcode-upload').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo })
  await expect(page.getByText(/No barcode found|Found a/)).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Card number').fill('6006491234567890')
  await page.getByRole('button', { name: 'Save changes' }).click()

  await expect(page.getByTestId('card-balance')).toHaveText('$25.00')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /•••• 7890/ })).toBeVisible()

  // Stored as a JPEG well under the 5 MB limit.
  const { data: me } = await admin.from('household_members').select('household_id').eq('user_id', userId).single()
  const { data: files } = await admin.storage.from('card-images').list(me!.household_id)
  const jpg = files?.find((f) => f.name.endsWith('.jpg'))
  expect(jpg).toBeTruthy()
  expect(Number(jpg!.metadata?.size)).toBeLessThan(5 * 1024 * 1024)
})
