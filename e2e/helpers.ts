import { expect, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'

export const TEST_PASSWORD = 'e2e correct horse battery'

/**
 * Create a confirmed user with a password, sign in through the login form and create
 * a household. Returns the user id (caller cleans up).
 */
export async function signInFresh(page: Page, admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { password_set: true },
  })
  if (error) throw error
  await page.goto('/')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByLabel('Your name').fill('E2E')
  await page.getByRole('button', { name: 'Create a new household' }).click()
  await page.getByRole('button', { name: 'Create household' }).click()
  await expect(page.getByTestId('grand-total')).toHaveText('$0.00')
  return data.user.id
}
