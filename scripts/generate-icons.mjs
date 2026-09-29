// Renders public/icon.svg to the PNG icons the PWA manifest and iOS need.
// Usage: node scripts/generate-icons.mjs   (uses Playwright's Chromium)
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8')
const targets = [
  { file: 'pwa-192.png', size: 192, pad: 0 },
  { file: 'pwa-512.png', size: 512, pad: 0 },
  { file: 'pwa-512-maskable.png', size: 512, pad: 0.1 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
]

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await browser.newPage()
for (const { file, size, pad } of targets) {
  const inner = Math.round(size * (1 - pad * 2))
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<body style="margin:0;background:#0f172a;display:grid;place-items:center;width:${size}px;height:${size}px">
       <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
     </body>`,
  )
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: false })
}
await browser.close()
