import type { AlbionItem, AlbionPlayer, AlbionServer } from '../shared/types'
import { AppDatabase } from './database'
import { SERVERS } from './servers'

interface PriceRow {
  item_id: string
  city: string
  quality: number
  sell_price_min: number
  sell_price_min_date?: string
}

const PRICE_CACHE_MS = 60 * 60 * 1000
const MAX_MARKET_AGE_MS = 24 * 60 * 60 * 1000
const CITIES = [
  'Bridgewatch',
  'Martlock',
  'Thetford',
  'Lymhurst',
  'Fort Sterling',
  'Caerleon',
  'Brecilien'
]

export class PriceService {
  constructor(private readonly db: AppDatabase) {}

  async calculateVictimValue(server: AlbionServer, victim: AlbionPlayer | undefined): Promise<number> {
    if (!victim) return 0
    const items = collectItems(victim)
    let total = 0
    for (const item of items) {
      if (!item.Type) continue
      const price = await this.getMedianPrice(server, item.Type, Math.max(1, item.Quality ?? 1))
      total += price * Math.max(1, item.Count ?? 1)
    }
    return Math.round(total)
  }

  async getMedianPrice(server: AlbionServer, itemId: string, quality: number): Promise<number> {
    const cached = this.db.getCachedPrice(server, itemId, quality, PRICE_CACHE_MS)
    if (cached !== null) return cached

    const url = new URL(
      `/api/v2/stats/prices/${encodeURIComponent(itemId)}.json`,
      SERVERS[server].priceBaseUrl
    )
    url.searchParams.set('locations', CITIES.join(','))
    url.searchParams.set('qualities', String(quality))

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Albion-PvP-Tracker/0.1' },
        signal: AbortSignal.timeout(15_000)
      })
      if (!response.ok) throw new Error(`AODP HTTP ${response.status}`)
      const rows = (await response.json()) as PriceRow[]
      const freshPrices = validPrices(rows, quality, true)
      const prices = freshPrices.length >= 2 ? freshPrices : validPrices(rows, quality, false)
      const price = median(prices)
      this.db.saveCachedPrice(server, itemId, quality, price)
      return price
    } catch {
      return 0
    }
  }
}

export function collectItems(player: AlbionPlayer): AlbionItem[] {
  const equipment = Object.values(player.Equipment ?? {}).filter(Boolean) as AlbionItem[]
  const inventory = (player.Inventory ?? []).filter(Boolean) as AlbionItem[]
  return [...equipment, ...inventory].filter((item) => Boolean(item.Type))
}

export function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function validPrices(rows: PriceRow[], quality: number, freshOnly: boolean): number[] {
  const now = Date.now()
  return rows
    .filter((row) => row.quality === quality && row.sell_price_min > 0)
    .filter((row) => {
      if (!freshOnly || !row.sell_price_min_date) return true
      const timestamp = Date.parse(`${row.sell_price_min_date}Z`)
      return Number.isFinite(timestamp) && now - timestamp <= MAX_MARKET_AGE_MS
    })
    .map((row) => row.sell_price_min)
}
