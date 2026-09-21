import type { AlbionItem, AlbionPlayer, AlbionServer } from '../shared/types'
import { AppDatabase } from './database'
import { SERVERS } from './servers'

export const PRICING_METHOD = 'BRECILIEN_SELL_MAX'
interface PriceRow {
  item_id: string
  city: string
  quality: number
  sell_price_max: number
}
const PRICE_CACHE_MS = 60 * 60 * 1000

export class PriceService {
  constructor(private readonly db: AppDatabase) {}

  async calculateVictimValue(server: AlbionServer, victim: AlbionPlayer | undefined): Promise<number> {
    if (!victim) return 0
    let total = 0
    for (const item of collectItems(victim)) {
      const price = await this.getMaxSellPrice(server, item.Type!, Math.max(1, item.Quality ?? 1))
      total += price * Math.max(1, item.Count ?? 1)
    }
    return Math.round(total)
  }

  async getMaxSellPrice(server: AlbionServer, itemId: string, quality: number): Promise<number> {
    const cached = this.db.getCachedPrice(server, itemId, quality, PRICE_CACHE_MS)
    if (cached !== null) return cached
    const url = new URL(`/api/v2/stats/prices/${encodeURIComponent(itemId)}.json`, SERVERS[server].priceBaseUrl)
    url.searchParams.set('locations', 'Brecilien')
    url.searchParams.set('qualities', String(quality))
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Albion-PvP-Tracker/0.1' }, signal: AbortSignal.timeout(15_000)
    })
    // A failed request must not overwrite an existing valuation with zero.
    if (!response.ok) throw new Error(`AODP HTTP ${response.status}`)
    const rows = await response.json() as PriceRow[]
    if (!Array.isArray(rows)) throw new Error('Invalid market price response')
    const price = brecilienMaxSell(rows, itemId, quality)
    this.db.saveCachedPrice(server, itemId, quality, price)
    return price
  }
}

export function collectItems(player: AlbionPlayer): AlbionItem[] {
  const equipment = Object.values(player.Equipment ?? {}).filter(Boolean) as AlbionItem[]
  const inventory = (player.Inventory ?? []).filter(Boolean) as AlbionItem[]
  return [...equipment, ...inventory].filter((item) => Boolean(item.Type))
}

export function brecilienMaxSell(rows: PriceRow[], itemId: string, quality: number): number {
  const prices = rows.filter((row) => row.item_id === itemId && row.city === 'Brecilien' && row.quality === quality)
    .map((row) => row.sell_price_max).filter((price) => Number.isFinite(price) && price > 0)
  return prices.length ? Math.round(Math.max(...prices)) : 0
}
