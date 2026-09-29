import { expect, test } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { signInFresh } from './helpers'

// Assisted check round trip: "Check now" → the real worker hands a page to the live
// view → the app shows "Your turn" with the live-view link → the live view shows the
// page → the balance is recorded and the live view says Done.

const url = process.env.SUPABASE_TEST_URL
const anonKey = process.env.SUPABASE_TEST_ANON_KEY
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY

test.skip(!url || !anonKey || !serviceKey, 'Set SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY (dev or local stack only)')

let admin: SupabaseClient
const userIds: string[] = []
let worker: ChildProcess | undefined
const tag = randomUUID().slice(0, 8)
const viewerPort = 18000 + Math.floor(Math.random() * 1000)

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

test('assisted check: the app links to the live view, then records the balance', async ({ page, context }) => {
  userIds.push(await signInFresh(page, admin, `e2e-assist-${tag}@example.com`))
  await page.getByRole('link', { name: 'Add your first card' }).click()
  await page.getByLabel('Merchant').selectOption({ label: 'Indigo' })
  await page.getByLabel('Card number').fill('6006491234567890')
  await page.getByLabel('PIN (optional)').fill('Qz7481')
  await page.getByLabel('Current balance').fill('50.00')
  await page.getByRole('button', { name: 'Add card' }).click()
  await expect(page.getByTestId('card-balance')).toHaveText('$50.00')
  const cardUrl = page.url()

  await page.goto('/settings')
  await page.getByRole('button', { name: /Indigo/ }).click()
  await page.getByLabel('Automatic balance check').selectOption('sportchek')
  await page.getByRole('button', { name: 'Save merchant' }).click()
  await expect(page.getByText('auto-check on')).toBeVisible()

  const botEmail = `e2e-assist-bot-${tag}@example.com`
  const botPassword = `bot-${randomUUID()}`
  const bot = await admin.auth.admin.createUser({ email: botEmail, password: botPassword, email_confirm: true })
  if (bot.error) throw bot.error
  userIds.push(bot.data.user.id)
  const { data: me } = await admin.from('household_members').select('household_id').eq('user_id', userIds[0]).single()
  const add = await admin
    .from('household_members')
    .insert({ household_id: me!.household_id, user_id: bot.data.user.id, display_name: 'Auto-check', is_service: true })
  if (add.error) throw add.error

  const workerLog: string[] = []
  worker = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: fileURLToPath(new URL('../worker', import.meta.url)),
    env: {
      ...process.env,
      SUPABASE_URL: url,
      SUPABASE_ANON_KEY: anonKey,
      WORKER_EMAIL: botEmail,
      WORKER_PASSWORD: botPassword,
      POLL_INTERVAL_SECONDS: '1',
      WORKER_FAKE_BALANCE_CENTS: '2500',
      WORKER_FAKE_HANDOVER_MS: '12000',
      VIEWER_PUBLIC_URL: `http://127.0.0.1:${viewerPort}`,
      VIEWER_PORT: String(viewerPort),
      CHROMIUM_PATH: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? process.env.CHROMIUM_PATH ?? '',
      HEARTBEAT_FILE: `/tmp/e2e-heartbeat-${tag}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  worker.stdout?.on('data', (d) => workerLog.push(String(d)))
  worker.stderr?.on('data', (d) => workerLog.push(String(d)))

  await page.goto(cardUrl)
  await page.getByRole('button', { name: 'Check balance now (automatic)' }).click()

  // Handed over: the app offers the live view.
  const link = page.getByTestId('assist-link')
  await expect(link).toBeVisible({ timeout: 30_000 })
  const href = await link.getAttribute('href')
  expect(href).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${viewerPort}/v/[A-Za-z0-9_-]{32}$`))
  expect(await link.getAttribute('target')).toBe('_blank')

  // The live view shows the worker's page.
  const live = await context.newPage()
  await live.goto(href!)
  await expect(live.getByText('Your turn')).toBeVisible()
  await expect(live.locator('#screen')).toHaveAttribute('src', /^data:image\/jpeg;base64,/)

  // The check finishes: balance recorded, the live view says Done, the link is gone.
  await expect(page.getByTestId('card-balance')).toHaveText('$25.00', { timeout: 30_000 })
  await expect(page.getByTestId('assist-link')).toHaveCount(0)
  await expect(page.getByTestId('auto-check-status')).toContainText('Auto-checked')
  await expect(live.getByText('Done!')).toBeVisible()
  expect((await live.request.get(href!)).status()).toBe(404)

  const logs = workerLog.join('')
  expect(logs).toContain('handed over')
  expect(logs).not.toContain('6006491234567890')
  expect(logs).not.toContain('Qz7481')
  expect(logs).not.toContain(href!.split('/v/')[1])
})
