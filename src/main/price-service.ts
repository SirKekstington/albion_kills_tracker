import { setTimeout as delay } from 'node:timers/promises'
import type { AlbionItem, AlbionPlayer, AlbionServer } from '../shared/types'
import { parseUtcTimestamp, PRICE_QUALITY } from '../shared/pricing'
import { AppDatabase } from './database'
import { SERVERS } from './servers'
import { Diagnostics } from './diagnostics'

export { PRICING_METHOD } from '../shared/pricing'
export interface HistoryRow {
  item_id: string
  location: string
  quality: number
  data: Array<{ item_count: number; avg_price: number; timestamp: string }>
}
const DAY_MS = 86400000
const PRICE_CACHE_MS = 60 * 60 * 1000
const MARKET_CITIES = ['Brecilien', 'Bridgewatch', 'Caerleon', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford']

export function historyWindow(now = Date.now()): { start: number; end: number } {
  const date = new Date(now)
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return { start: end - 7 * DAY_MS, end }
}

export class PriceService {
  private pending = new Map<string, Promise<number>>()
  private nextRequestAt = 0
  constructor(private readonly db: AppDatabase, private readonly diagnostics = new Diagnostics()) {}

  async calculateVictimValue(server: AlbionServer, victim: AlbionPlayer | undefined): Promise<number> {
    if (!victim) return 0
    let total = 0
    for (const item of collectItems(victim)) {
      const price = await this.getAveragePrice(server, item.Type!)
      total += price * Math.max(1, item.Count ?? 1)
    }
    return Math.round(total)
  }

  getAveragePrice(server: AlbionServer, itemId: string): Promise<number> {
    const key = `${server}:${itemId}`
    const existing = this.pending.get(key)
    if (existing) return existing
    const request = this.loadPrice(server, itemId).finally(() => this.pending.delete(key))
    this.pending.set(key, request)
    return request
  }

  private async loadPrice(server: AlbionServer, itemId: string): Promise<number> {
    const quality = PRICE_QUALITY
    const cached = this.db.getCachedPrice(server, itemId, PRICE_CACHE_MS)
    if (cached !== null) return cached
    // Stay below the market API's 300 requests / 5 minute limit, including simultaneous callers.
    const wait = Math.max(0, this.nextRequestAt - Date.now())
    this.nextRequestAt = Date.now() + wait + 1100
    if (wait) await delay(wait)
    const window = historyWindow()
    const url = new URL(`/api/v2/stats/history/${encodeURIComponent(itemId)}.json`, SERVERS[server].priceBaseUrl)
    url.searchParams.set('locations', MARKET_CITIES.join(','))
    url.searchParams.set('qualities', `1,${quality}`)
    url.searchParams.set('date', new Date(window.start).toISOString().slice(0, 10))
    url.searchParams.set('end_date', new Date(window.end).toISOString().slice(0, 10))
    url.searchParams.set('time-scale', '24')
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Albion-PvP-Tracker/0.1' }, signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`AODP history HTTP ${response.status}: ${itemId} Q${quality}`)
    const rows = await response.json() as HistoryRow[]
    if (!Array.isArray(rows)) throw new Error('Invalid market history response')
    const selected = selectHistoricalPrice(rows, itemId, window)
    const price = selected.price
    this.db.saveCachedPrice(server, itemId, price)
    this.diagnostics.log(price ? 'info' : 'warn', 'pricing', price ? 'Historical average calculated' : 'No historical price; item contributes zero', {
      itemId, ...selected, server, start: window.start, end: window.end
    })
    return price
  }
}

export function collectItems(player: AlbionPlayer): AlbionItem[] {
  const equipment = Object.values(player.Equipment ?? {}).filter(Boolean) as AlbionItem[]
  const inventory = (player.Inventory ?? []).filter(Boolean) as AlbionItem[]
  return [...equipment, ...inventory].filter((item) => Boolean(item.Type))
}

export function selectHistoricalPrice(rows: HistoryRow[], itemId: string, window = historyWindow()): { price: number; quality: number; source: string } {
  // Keep the requested Excellent reference where available. Quality-less items
  // (food, potions, resources) are reported as Normal by AODP.
  for (const quality of [PRICE_QUALITY, 1]) {
    const brecilien = historicalAverage(rows, itemId, quality, window)
    if (brecilien > 0) return { price: brecilien, quality, source: 'Brecilien' }
    const markets = historicalAverage(rows, itemId, quality, window, MARKET_CITIES)
    if (markets > 0) return { price: markets, quality, source: 'Regular cities' }
  }
  return { price: 0, quality: PRICE_QUALITY, source: 'No history' }
}

export function historicalAverage(rows: HistoryRow[], itemId: string, quality: number, window = historyWindow(), cities: readonly string[] = ['Brecilien']): number {
  let silver = 0
  let count = 0
  for (const row of rows) {
    if (row.item_id !== itemId || !cities.includes(row.location) || row.quality !== quality) continue
    if (!Array.isArray(row.data)) throw new Error('Invalid market history buckets')
    for (const bucket of row.data) {
      const time = parseUtcTimestamp(bucket.timestamp)
      if (time < window.start || time >= window.end || !Number.isFinite(time)) continue
      if (!Number.isFinite(bucket.avg_price) || bucket.avg_price <= 0 || !Number.isFinite(bucket.item_count) || bucket.item_count <= 0) continue
      silver += bucket.avg_price * bucket.item_count
      count += bucket.item_count
    }
  }
  return count ? Math.round(silver / count) : 0
}
