import { afterEach, describe, expect, it, vi } from 'vitest'
import { brecilienMaxSell, PriceService } from '../src/main/price-service'
import type { AppDatabase } from '../src/main/database'

afterEach(() => vi.unstubAllGlobals())
const row = { item_id: 'T4_BAG', city: 'Brecilien', quality: 1, sell_price_max: 900, sell_price_min: 100 }
describe('Brecilien maximum sell pricing', () => {
  it('uses only the matching city, item and quality maximum', () => {
    expect(brecilienMaxSell([row, { ...row, city: 'Caerleon', sell_price_max: 99999 },
      { ...row, quality: 5, sell_price_max: 50000 }, { ...row, item_id: 'T8_BAG', sell_price_max: 40000 }], 'T4_BAG', 1)).toBe(900)
    expect(brecilienMaxSell([{ ...row, sell_price_max: 0 }, { ...row, sell_price_max: NaN }], 'T4_BAG', 1)).toBe(0)
    expect(brecilienMaxSell([], 'T4_BAG', 1)).toBe(0)
  })

  it('queries Brecilien and multiplies equipment and inventory stacks', async () => {
    const saveCachedPrice = vi.fn()
    const db = { getCachedPrice: () => null, saveCachedPrice } as unknown as AppDatabase
    const fetchPrice = vi.fn(async () => new Response(JSON.stringify([row])))
    vi.stubGlobal('fetch', fetchPrice)
    const service = new PriceService(db)
    expect(await service.calculateVictimValue('EUROPE', {
      Equipment: { Bag: { Type: 'T4_BAG', Quality: 1 } }, Inventory: [{ Type: 'T4_BAG', Quality: 0, Count: 3 }]
    })).toBe(3600)
    const url = (fetchPrice.mock.calls[0] as unknown as [URL])[0]
    expect(url.searchParams.get('locations')).toBe('Brecilien')
    expect(url.searchParams.get('qualities')).toBe('1')
    expect(saveCachedPrice).toHaveBeenCalledWith('EUROPE', 'T4_BAG', 1, 900)
  })

  it('retains prior valuations on network failure instead of caching zero', async () => {
    const saveCachedPrice = vi.fn()
    const db = { getCachedPrice: () => null, saveCachedPrice } as unknown as AppDatabase
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(new PriceService(db).getMaxSellPrice('EUROPE', 'T4_BAG', 1)).rejects.toThrow('AODP HTTP 503')
    expect(saveCachedPrice).not.toHaveBeenCalled()
  })
})
