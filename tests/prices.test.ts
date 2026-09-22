import { afterEach, describe, expect, it, vi } from 'vitest'
import { historicalMedian, historyWindow, PriceService, selectHistoricalPrice } from '../src/main/price-service'
import type { AppDatabase } from '../src/main/database'

const window = { start: Date.UTC(2026, 8, 14), end: Date.UTC(2026, 8, 21) }
const row = { item_id: 'T4_BAG', location: 'Brecilien', quality: 1, data: [
  { timestamp: '2026-09-14T00:00:00', avg_price: 100, item_count: 90 },
  { timestamp: '2026-09-15T00:00:00Z', avg_price: 1000, item_count: 10 }
] }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('seven-day historical medians', () => {
  it('resists a high-volume outlier and handles odd, even and single samples', () => {
    const median = (prices: number[]) => historicalMedian([{ ...row, data: prices.map((price, i) => ({
      timestamp: `2026-09-${14 + i}T00:00:00Z`, avg_price: price, item_count: price > 1000 ? 99999 : 1
    })) }], row.item_id, 1, window)
    expect(median([15000000, 100, 110])).toBe(110)
    expect(median([15000000, 100, 110, 120])).toBe(115)
    expect(median([123])).toBe(123)
  })
  it('takes the median of daily prices, excludes other cities, qualities and dates', () => {
    expect(historicalMedian([row, { ...row, location: 'Caerleon' }, { ...row, quality: 5 }, { ...row, item_id: 'T8_BAG' }], 'T4_BAG', 1, window)).toBe(550)
    expect(historicalMedian([{ ...row, data: [...row.data,
      { timestamp: '2026-09-13T00:00:00', avg_price: 15000000, item_count: 9999 },
      { timestamp: '2026-09-21T00:00:00', avg_price: 15000000, item_count: 9999 },
      { timestamp: '2026-09-16T00:00:00', avg_price: 15000000, item_count: 0 }
    ] }], 'T4_BAG', 1, window)).toBe(550)
    expect(historicalMedian([], 'T4_BAG', 1, window)).toBe(0)
    expect(historyWindow(Date.UTC(2026, 8, 21, 18))).toEqual(window)
  })

  it('shares Excellent history across all item qualities, stacks and concurrent requests', async () => {
    vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 21, 18))
    const cache = new Map<string, number>()
    const db = {
      getCachedPrice: (server: string, id: string) => cache.get(server + id) ?? null,
      saveCachedPrice: (server: string, id: string, price: number) => cache.set(server + id, price)
    } as unknown as AppDatabase
    const fetchPrice = vi.fn(async () => new Response(JSON.stringify([row, { ...row, quality: 4 }])))
    vi.stubGlobal('fetch', fetchPrice)
    const service = new PriceService(db)
    const values = await Promise.all([0, 1, 2, 3, 4, 5].map((quality) => service.calculateVictimValue('EUROPE', {
      Equipment: { Bag: { Type: 'T4_BAG', Quality: quality } }, Inventory: [{ Type: 'T4_BAG', Count: 3 }]
    })))
    expect(values).toEqual([2200, 2200, 2200, 2200, 2200, 2200])
    expect(await new PriceService(db).getMedianPrice('EUROPE', 'T4_BAG')).toBe(550)
    const url = (fetchPrice.mock.calls[0] as unknown as [URL])[0]
    expect(url.pathname).toBe('/api/v2/stats/history/T4_BAG.json')
    expect(url.searchParams.get('locations')).toContain('Brecilien')
    expect(url.searchParams.get('locations')).toContain('Fort Sterling')
    expect(url.searchParams.get('locations')).not.toContain('Black Market')
    expect(url.searchParams.get('qualities')).toBe('1,4')
    expect(url.searchParams.get('date')).toBe('2026-09-14')
    expect(url.searchParams.get('end_date')).toBe('2026-09-21')
    expect(url.searchParams.get('time-scale')).toBe('24')
    expect(fetchPrice).toHaveBeenCalledTimes(1)
  })

  it('does not cache zero for a failed history request', async () => {
    const saveCachedPrice = vi.fn()
    const db = { getCachedPrice: () => null, saveCachedPrice } as unknown as AppDatabase
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(new PriceService(db).getMedianPrice('EUROPE', 'T4_BAG')).rejects.toThrow('AODP history HTTP 503')
    expect(saveCachedPrice).not.toHaveBeenCalled()
  })

  it('prefers Excellent in Brecilien, then regular cities, and uses Normal only when Excellent is absent', () => {
    const excellent = { ...row, quality: 4, data: [{ timestamp: '2026-09-15T00:00:00Z', avg_price: 300, item_count: 10 }] }
    const elsewhere = { ...excellent, location: 'Fort Sterling' }
    expect(selectHistoricalPrice([row, elsewhere], row.item_id, window)).toEqual({ price: 300, quality: 4, source: 'Regular cities' })
    expect(selectHistoricalPrice([row, excellent, { ...elsewhere, data: row.data }], row.item_id, window)).toEqual({ price: 300, quality: 4, source: 'Brecilien' })
    expect(selectHistoricalPrice([row], row.item_id, window)).toEqual({ price: 550, quality: 1, source: 'Brecilien' })
    expect(selectHistoricalPrice([{ ...row, location: 'Lymhurst' }], row.item_id, window)).toEqual({ price: 550, quality: 1, source: 'Regular cities' })
    expect(selectHistoricalPrice([{ ...excellent, location: 'Black Market' }], row.item_id, window).price).toBe(0)
    expect(selectHistoricalPrice([{ ...excellent, quality: 5 }], row.item_id, window).price).toBe(0)
  })
})
