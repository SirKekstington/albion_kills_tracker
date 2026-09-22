import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { UpdateService } from './update-service'
import { translate } from '../shared/translations'
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
let retentionTimer: NodeJS.Timeout | undefined
let updates: UpdateService
let updateTimer: NodeJS.Timeout | undefined
let updateCheckStarted = false
const diagnostics = new Diagnostics(!app.isPackaged)

const serverSchema = z.enum(['EUROPE', 'AMERICAS', 'ASIA'])
const rangeSchema = z.enum(['TODAY', '7D', '30D', 'ALL'])
const settingsSchema = z.object({
  eventRetentionDays: z.union([z.literal(0), z.literal(7), z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).default(0),
  theme: z.enum(['dark', 'light']).default('dark'),
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
    backgroundColor: db.getSettings().theme === 'light' ? '#f3f3f3' : '#202020',
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
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    if (!updateCheckStarted && app.isPackaged) {
      updateCheckStarted = true
      void updates.check(true)
      updateTimer = setInterval(() => { void updates.check(true) }, 6 * 60 * 60 * 1000)
    }
  })
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
  ipcMain.handle('updates:get', () => updates.getState())
  ipcMain.handle('updates:check', () => updates.check())
  ipcMain.handle('updates:install', () => updates.install())
  ipcMain.handle('fights:page', (_event, range: unknown, page: unknown, pageSize: unknown) =>
    statistics.getFightPage(rangeSchema.parse(range), z.number().int().min(1).max(100000000).parse(page),
      z.union([z.literal(10), z.literal(15), z.literal(20)]).parse(pageSize)))
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
    db.pruneEvents()
    mainWindow?.webContents.setZoomFactor(settings.uiScale)
    mainWindow?.setBackgroundColor(settings.theme === 'light' ? '#f3f3f3' : '#202020')
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
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  updates = new UpdateService(autoUpdater, app.getVersion(), app.isPackaged && process.platform === 'win32',
    (version) => db.wasUpdatePrompted(version), (version) => db.rememberUpdatePrompt(version),
    async (version) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question', title: 'Update Yes/No',
        message: translate(db.getSettings().language, 'Version {version} is available. Update now?', { version }),
        detail: translate(db.getSettings().language, 'The update will download and restart the app. You can also update later in Settings.'),
        buttons: ['Yes', 'No'], defaultId: 1, cancelId: 1, noLink: true
      })
      return result.response === 0
    }, notifyRenderer)
  db.pruneEvents()
  retentionTimer = setInterval(() => {
    try { if (db.pruneEvents() > 0) notifyRenderer() }
    catch (error) { console.error('Could not remove expired events:', error) }
  }, 60 * 60 * 1000)
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
  if (updateTimer) clearInterval(updateTimer)
  if (retentionTimer) clearInterval(retentionTimer)
  collector?.stop()
  void overlay?.stop()
  db?.close()
})
