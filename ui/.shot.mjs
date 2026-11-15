import pw from 'file:///C:/Users/q1fre/node_modules/playwright/index.js'
const { chromium } = pw

const out = process.argv[2] || 'C:/Users/q1fre/AppData/Local/Temp'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto('http://localhost:5180', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/shot-board.png` })

await page.getByRole('button', { name: 'Graph Explorer' }).click()
await page.waitForTimeout(6000)
await page.screenshot({ path: `${out}/shot-graph.png` })

const info = await page.evaluate(() => ({
  canvases: [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height })),
  bodyText: document.body.innerText.slice(0, 1200),
}))
console.log(JSON.stringify({ info, logs }, null, 2))
await browser.close()
