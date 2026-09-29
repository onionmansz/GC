import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { signInFresh } from './helpers'

const url = process.env.SUPABASE_TEST_URL
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

test.skip(!url || !anonKey || !serviceKey, 'Set SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY (dev or local stack only)')

let admin: SupabaseClient
let userId: string
const email = `e2e-reset-${randomUUID().slice(0, 8)}@example.com`
const NEW_PASSWORD = 'a brand new passphrase'

test.beforeAll(() => {
  admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterAll(async () => {
  if (!admin || !userId) return
  const { data } = await admin.from('household_members').select('household_id').eq('user_id', userId)
  const ids = (data ?? []).map((r) => r.household_id as string)
  if (ids.length) await admin.from('households').delete().in('id', ids)
  await admin.auth.admin.deleteUser(userId)
})

test('forgot password link → set a new password → sign in with it', async ({ page }) => {
  userId = await signInFresh(page, admin, email)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText('Check your email')).toBeVisible()

  // The emailed link, generated server-side.
  const link = await admin.auth.admin.generateLink({ type: 'recovery', email })
  if (link.error) throw link.error
  await page.goto(`/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=recovery`)
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible()
  // Reloading must not skip the step.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible()
  await page.getByLabel('New password').fill(NEW_PASSWORD)
  await page.getByLabel('Confirm password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByTestId('grand-total')).toBeVisible()

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('grand-total')).toBeVisible()
})
