import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { signInFresh } from './helpers'

const url = process.env.SUPABASE_TEST_URL
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

test.skip(!url || !anonKey || !serviceKey, 'Set SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY (dev or local stack only)')

let admin: SupabaseClient
const userIds: string[] = []
let worker: ChildProcess | undefined
const tag = randomUUID().slice(0, 8)
const email = `e2e-auto-${tag}@example.com`
const botEmail = `e2e-bot-${tag}@example.com`
const botPassword = `bot-${randomUUID()}`

test.beforeAll(async () => {
  admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
})

test.afterAll(async () => {
  worker?.kill('SIGTERM')
  if (!admin) return
  const { data } = await admin.from('household_members').select('household_id').in('user_id', userIds)
  const ids = [...new Set((data ?? []).map((r) => r.household_id as string))]
  if (ids.length) await admin.from('households').delete().in('id', ids)
  for (const id of userIds) await admin.auth.admin.deleteUser(id)
})

test('"Check now" queues a check; the worker records the balance as Auto-check', async ({ page }) => {
  // Person: set up household and an Indigo card at $50.
  userIds.push(await signInFresh(page, admin, email))
  await page.getByRole('link', { name: 'Add your first card' }).click()
  await page.getByLabel('Merchant').selectOption({ label: 'Indigo' })
  await page.getByLabel('Card number').fill('6006491234567890')
  await page.getByLabel('PIN (optional)').fill('Qz7481')
  await page.getByLabel('Current balance').fill('50.00')
  await page.getByRole('button', { name: 'Add card' }).click()
  await expect(page.getByTestId('card-balance')).toHaveText('$50.00')
  const cardUrl = page.url()

  // No button until the merchant has an automatic checker.
  await expect(page.getByTestId('auto-check')).toHaveCount(0)
  await page.goto('/settings')
  await page.getByRole('button', { name: /Indigo/ }).click()
  await page.getByLabel('Automatic balance check').selectOption('indigo')
  await page.getByRole('button', { name: 'Save merchant' }).click()
  await expect(page.getByText('auto-check on')).toBeVisible()

  // Service member (what supabase/snippets/add_auto_check_member.sql does).
  const bot = await admin.auth.admin.createUser({ email: botEmail, password: botPassword, email_confirm: true })
  if (bot.error) throw bot.error
  userIds.push(bot.data.user.id)
  const { data: me } = await admin.from('household_members').select('household_id').eq('user_id', userIds[0]).single()
  const add = await admin
    .from('household_members')
    .insert({ household_id: me!.household_id, user_id: bot.data.user.id, display_name: 'Auto-check', is_service: true })
  if (add.error) throw add.error

  // Queue the check before the worker runs: it waits as "Queued…".
  await page.goto(cardUrl)
  await page.getByRole('button', { name: 'Check balance now (automatic)' }).click()
  await expect(page.getByTestId('auto-check-status')).toContainText(/Queued|Checking/)

  // Start the real worker with a fake Indigo lookup that "finds" $12.34.
  const workerDir = fileURLToPath(new URL('../worker', import.meta.url))
  worker = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: workerDir,
    env: {
      ...process.env,
      SUPABASE_URL: url,
      SUPABASE_ANON_KEY: anonKey,
      WORKER_EMAIL: botEmail,
      WORKER_PASSWORD: botPassword,
      POLL_INTERVAL_SECONDS: '1',
      WORKER_FAKE_BALANCE_CENTS: '1234',
      HEARTBEAT_FILE: `/tmp/e2e-heartbeat-${tag}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const workerLog: string[] = []
  worker.stdout?.on('data', (d) => workerLog.push(String(d)))
  worker.stderr?.on('data', (d) => workerLog.push(String(d)))

  await expect(page.getByTestId('card-balance')).toHaveText('$12.34', { timeout: 30_000 })
  await expect(page.getByTestId('auto-check-status')).toContainText('Auto-checked')
  await expect(page.getByTestId('ledger')).toContainText('Balance set · Auto-check')
  await expect(page.getByTestId('ledger')).toContainText('−$37.66')

  // The service member doesn't appear as a card holder option.
  await page.goto(`${cardUrl}/edit`)
  await expect(page.getByLabel('Who has it?')).toBeVisible()
  expect(await page.getByLabel('Who has it?').locator('option').allTextContents()).not.toContain('Auto-check')

  // Worker logs never contain the card number or PIN.
  const logs = workerLog.join('')
  expect(logs).toContain('ok')
  expect(logs).not.toContain('6006491234567890')
  expect(logs).not.toContain('Qz7481')
})
