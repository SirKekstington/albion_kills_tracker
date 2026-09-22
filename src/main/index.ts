import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import type { AlbionServer, AppSettings, TimeRange } from '../shared/types'
import { AlbionApi } from './albion-api'
import { AppDatabase, getRangeStart } from './database'
import { EventCollector } from './event-collector'
import { OverlayServer } from './overlay-server'
import { PriceService } from './price-service'
import { StatisticsService } from './statistics-service'
import { ItemImageCache } from './item-image-cache'
import { DEFAULT_OVERLAY_APPEARANCE } from '../shared/overlay'
import { Diagnostics } from './diagnostics'

let mainWindow: BrowserWindow | null = null
let db: AppDatabase
let collector: EventCollector
let overlay: OverlayServer
let api: AlbionApi
let statistics: StatisticsService
let itemImages: ItemImageCache
let prices: PriceService
const diagnostics = new Diagnostics(!app.isPackaged)

const serverSchema = z.enum(['EUROPE', 'AMERICAS', 'ASIA'])
const rangeSchema = z.enum(['TODAY', '7D', '30D', 'ALL'])
const settingsSchema = z.object({
  uiScale: z.number().min(1).max(2).default(1),
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
      zoomFactor: db.getSettings().uiScale,
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
      additionalArguments: app.isPackaged ? [] : ['--tracker-dev-debug'],
      nodeIntegration: false
    }
  })
  mainWindow.setMenu(null)
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(db.getSettings().uiScale)
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
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
  if (!app.isPackaged) {
    ipcMain.handle('debug:snapshot', () => {
      const profile = db.getActiveProfile()
      const tracking = profile ? db.getProfitTracking(profile.id) : null
      const cutoff = tracking?.mode === 'SESSION' ? tracking.startedAt ?? 0 : getRangeStart('TODAY')!
      return {
        now: Date.now(), profile, tracking, collector: collector.getStatus(),
        pendingPrices: profile ? db.countPendingPrices(profile.id) : 0,
        entries: diagnostics.snapshot(),
        events: profile ? db.listEvents(profile.id, 'ALL', 50).map((event) => ({
          eventId: event.eventId, timestamp: event.timestamp, type: event.type,
          included: event.timestamp >= cutoff,
          reason: event.timestamp < cutoff ? 'Before tracking start' : event.type === 'ASSIST' ? 'Assist: excluded from net profit' : 'Included',
          pricingMethod: event.pricingMethod ?? 'Unknown', value: event.estimatedValue
        })) : []
      }
    })
    ipcMain.handle('debug:import', (_event, eventId: unknown) => collector.importEvent(z.string().regex(/^\d{1,20}$/).parse(eventId)))
  }
  ipcMain.handle('language:set', (_event, language: unknown) => {
    db.setLanguage(z.enum(['en', 'de']).parse(language))
    notifyRenderer()
  })
  ipcMain.handle('tracking:set', (_event, mode: unknown) => {
    const validMode = z.enum(['TODAY', 'SESSION']).parse(mode)
    const profile = db.getActiveProfile()
    if (!profile) throw new Error('No active character')
    db.setProfitTracking(profile.id, validMode)
    diagnostics.log('info', 'tracking', 'Tracking mode changed', { profileId: profile.id, ...db.getProfitTracking(profile.id) })
    notifyRenderer()
  })
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
    const settings = { ...settingsSchema.parse(input), language: db.getSettings().language }
    db.saveSettings(settings)
    mainWindow?.webContents.setZoomFactor(settings.uiScale)
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
  Menu.setApplicationMenu(null)
  db = new AppDatabase(join(app.getPath('userData'), 'tracker.db'))
  api = new AlbionApi(diagnostics)
  itemImages = new ItemImageCache(join(app.getPath('userData'), 'item-images'))
  prices = new PriceService(db, diagnostics)
  statistics = new StatisticsService(db)
  overlay = new OverlayServer(statistics, () => db.getSettings())
  collector = new EventCollector(db, api, prices, notifyRenderer, diagnostics)
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
