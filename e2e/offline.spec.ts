import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { signInFresh } from './helpers'

const url = process.env.SUPABASE_TEST_URL
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

test.skip(!url || !anonKey || !serviceKey, 'Set SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY (dev or local stack only)')
// This test needs the real service worker to serve the app shell offline.
test.use({ serviceWorkers: 'allow' })

let admin: SupabaseClient
let userId: string
const email = `e2e-offline-${randomUUID().slice(0, 8)}@example.com`

test.beforeAll(async () => {
  admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterAll(async () => {
  if (!admin || !userId) return
  const { data } = await admin.from('household_members').select('household_id').eq('user_id', userId)
  const ids = (data ?? []).map((r) => r.household_id as string)
  if (ids.length) await admin.from('households').delete().in('id', ids)
  await admin.auth.admin.deleteUser(userId)
})

test('cold start offline shows last-synced cards read-only, and till mode still works', async ({ page, context }) => {
  userId = await signInFresh(page, admin, email)

  await page.goto('/cards/new')
  await page.getByLabel('Merchant').selectOption({ label: 'Esso' })
  await page.getByLabel('Card number').fill('7000123456789012')
  await page.getByText('Barcode format (advanced)').click()
  await page.getByLabel('Format').selectOption('code128')
  await page.getByLabel('Current balance').fill('20')
  await page.getByRole('button', { name: 'Add card' }).click()
  await expect(page.getByTestId('card-balance')).toHaveText('$20.00')
  const cardUrl = page.url()

  await page.goto('/')
  await expect(page.getByTestId('grand-total')).toHaveText('$20.00')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForTimeout(1500) // let the query cache persist to IndexedDB

  await context.setOffline(true)
  await context.route(`${url}/**`, (r) => r.abort('internetdisconnected'))

  await page.goto('/')
  await expect(page.getByTestId('grand-total')).toHaveText('$20.00')
  await expect(page.getByRole('status')).toContainText("You're offline")
  await expect(page.getByTestId('last-synced')).toContainText('Last synced')

  await page.goto(cardUrl)
  await expect(page.getByTestId('card-balance')).toHaveText('$20.00')
  await expect(page.getByRole('button', { name: 'Spent $' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Set balance' })).toBeDisabled()

  await page.getByTestId('show-at-till').click()
  await expect(page.getByTestId('barcode-canvas')).toHaveAttribute('data-rendered', 'true')
})
