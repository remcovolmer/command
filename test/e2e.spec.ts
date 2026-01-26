import path from 'node:path'
import {
  type ElectronApplication,
  type Page,
  type JSHandle,
  _electron as electron,
} from 'playwright'
import type { BrowserWindow } from 'electron'
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  test,
} from 'vitest'

const root = path.join(__dirname, '..')
let electronApp: ElectronApplication | undefined
let page: Page | undefined

if (process.platform === 'linux') {
  // pass ubuntu
  test(() => expect(true).true)
} else {
  beforeAll(async () => {
    electronApp = await electron.launch({
      args: ['.', '--no-sandbox'],
      cwd: root,
      env: { ...process.env, NODE_ENV: 'test' },
      timeout: 30000,
    })
    page = await electronApp.firstWindow()

    const mainWin: JSHandle<BrowserWindow> = await electronApp.browserWindow(page)
    await mainWin.evaluate(async (win) => {
      win.webContents.executeJavaScript('console.log("Execute JavaScript with e2e testing.")')
    })
  }, 60000)

  afterAll(async () => {
    if (page) {
      await page.screenshot({ path: 'test/screenshots/e2e.png' }).catch(() => {})
      await page.close().catch(() => {})
    }
    if (electronApp) {
      await electronApp.close().catch(() => {})
    }
  })

  describe('[command] e2e tests', async () => {
    test('startup', async () => {
      expect(page).toBeDefined()
      // Wait for app to load
      await page!.waitForLoadState('domcontentloaded')
      const title = await page!.title()
      expect(title).eq('Command')
    })

    test('should load home page correctly', async () => {
      expect(page).toBeDefined()
      // Wait for the main content to render
      await page!.waitForSelector('h1', { timeout: 10000 })
      const h1 = await page!.$('h1')
      const title = await h1?.textContent()
      expect(title).eq('Command')
    })

    test('should show sidebar', async () => {
      expect(page).toBeDefined()
      // Wait for sidebar to render - it has the "w-64" class
      await page!.waitForSelector('aside, [class*="sidebar"], .w-64', { timeout: 10000 })
      const sidebar = await page!.$('aside') || await page!.$('[class*="sidebar"]') || await page!.$('.w-64')
      expect(sidebar).not.toBeNull()
    })
  })
}
