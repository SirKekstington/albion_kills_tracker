import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import type { AlbionServer, AppSettings, TimeRange } from '../shared/types'
import { AlbionApi } from './albion-api'
import { AppDatabase } from './database'
import { EventCollector } from './event-collector'
import { OverlayServer } from './overlay-server'
import { PriceService } from './price-service'
import { StatisticsService } from './statistics-service'
import { ItemImageCache } from './item-image-cache'
import { DEFAULT_OVERLAY_APPEARANCE } from '../shared/overlay'

let mainWindow: BrowserWindow | null = null
let db: AppDatabase
let collector: EventCollector
let overlay: OverlayServer
let api: AlbionApi
let statistics: StatisticsService
let itemImages: ItemImageCache
let prices: PriceService

const serverSchema = z.enum(['EUROPE', 'AMERICAS', 'ASIA'])
const rangeSchema = z.enum(['TODAY', '7D', '30D', 'ALL'])
const settingsSchema = z.object({
  overlayTransparent: z.boolean().default(false),
  overlayCustomEnabled: z.boolean().default(false),
  overlayHtml: z.string().max(100_000).default(DEFAULT_OVERLAY_APPEARANCE.overlayHtml),
  overlayCss: z.string().max(100_000).default(DEFAULT_OVERLAY_APPEARANCE.overlayCss),
  refreshSeconds: z.number().int().min(10).max(300),
  overlayEnabled: z.boolean(),
  overlayPort: z.number().int().min(1024).max(65535),
  launchAtStartup: z.boolean()
})
const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(64),
  guildName: z.string().max(100).optional(),
  server: serverSchema
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#090b11',
    title: 'Albion PvP Tracker',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function notifyRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tracker:updated')
}

async function applyOverlaySettings(settings: AppSettings): Promise<void> {
  if (settings.overlayEnabled) await overlay.start(settings.overlayPort)
  else await overlay.stop()
}

function registerIpc(): void {
  ipcMain.handle('fights:valuation', async (_event, eventId: unknown, mode: unknown) => {
    const result = await statistics.setFightValuation(
      z.string().min(1).max(128).parse(eventId), z.enum(['FULL', 'INVENTORY', 'NONE']).parse(mode), prices
    )
    notifyRenderer()
    return result
  })
  ipcMain.handle('items:image', (_event, itemId: unknown, quality: unknown) =>
    itemImages.get(z.string().min(1).max(200).parse(itemId), z.number().int().min(0).max(5).parse(quality))
  )
  ipcMain.handle('players:search', async (_event, server: AlbionServer, query: string) => {
    const validServer = serverSchema.parse(server)
    const validQuery = z.string().trim().min(2).max(64).parse(query)
    return api.searchPlayers(validServer, validQuery)
  })
  ipcMain.handle('profile:get', () => db.getActiveProfile())
  ipcMain.handle('profile:save', async (_event, input: unknown) => {
    db.saveProfile(profileSchema.parse(input))
    collector.restart()
    notifyRenderer()
  })
  ipcMain.handle('dashboard:get', (_event, range: TimeRange) =>
    statistics.getDashboard(rangeSchema.parse(range), collector.getStatus())
  )
  ipcMain.handle('collector:refresh', () => collector.refresh())
  ipcMain.handle('fights:details', (_event, eventId: unknown) =>
    statistics.getFightDetails(z.string().min(1).max(128).parse(eventId))
  )
  ipcMain.handle('settings:get', () => db.getSettings())
  ipcMain.handle('settings:save', async (_event, input: unknown) => {
    const settings = settingsSchema.parse(input)
    db.saveSettings(settings)
    app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup })
    await applyOverlaySettings(settings)
    collector.restart()
    notifyRenderer()
    return settings
  })
  ipcMain.handle('overlay:url', () => overlay.getUrl())
  ipcMain.handle('external:open', (_event, url: string) => {
    const parsed = new URL(z.string().url().parse(url))
    if (parsed.protocol !== 'https:') throw new Error('Only HTTPS links are allowed')
    return shell.openExternal(parsed.toString())
  })
}

app.whenReady().then(async () => {
  db = new AppDatabase(join(app.getPath('userData'), 'tracker.db'))
  api = new AlbionApi()
  itemImages = new ItemImageCache(join(app.getPath('userData'), 'item-images'))
  prices = new PriceService(db)
  statistics = new StatisticsService(db)
  overlay = new OverlayServer(statistics, () => db.getSettings())
  collector = new EventCollector(db, api, prices, notifyRenderer)
  registerIpc()
  createWindow()

  const settings = db.getSettings()
  try {
    await applyOverlaySettings(settings)
  } catch (error) {
    console.error('Could not start OBS overlay:', error)
  }
  collector.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  collector?.stop()
  void overlay?.stop()
  db?.close()
})
