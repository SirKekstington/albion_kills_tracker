import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ItemImageCache } from '../src/main/item-image-cache'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'albion-image-test-')) })
afterEach(async () => { vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }) })

describe('persistent item image cache', () => {
  it('deduplicates downloads and reads from disk after restarting the service', async () => {
    const fetchImage = vi.fn(async () => new Response(png))
    vi.stubGlobal('fetch', fetchImage)
    const cache = new ItemImageCache(directory)
    const [first, second] = await Promise.all([cache.get('T6_2H_AXE_AVALON@3', 5), cache.get('T6_2H_AXE_AVALON@3', 5)])
    expect(first).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(second).toBe(first)
    expect(fetchImage).toHaveBeenCalledTimes(1)
    const url = (fetchImage.mock.calls[0] as unknown as [URL])[0]
    expect(decodeURIComponent(url.pathname)).toBe('/v1/item/T6_2H_AXE_AVALON@3.png')
    expect(url.searchParams.get('quality')).toBe('5')
    expect(url.searchParams.get('locale')).toBe('en')
    expect(await new ItemImageCache(directory).get('T6_2H_AXE_AVALON@3', 5)).toBe(first)
    expect(fetchImage).toHaveBeenCalledTimes(1)
    await cache.get('T6_2H_AXE_AVALON@3', 4)
    expect(fetchImage).toHaveBeenCalledTimes(2)
  })

  it('normalizes consumable quality and retries failed downloads', async () => {
    const fetchImage = vi.fn().mockResolvedValueOnce(new Response('unavailable', { status: 404 }))
      .mockResolvedValueOnce(new Response('<html>not an image</html>'))
      .mockResolvedValueOnce(new Response(png))
    vi.stubGlobal('fetch', fetchImage)
    const cache = new ItemImageCache(directory)
    await expect(cache.get('T7_POTION_REVIVE', 0)).rejects.toThrow('HTTP 404')
    await expect(cache.get('T7_POTION_REVIVE', 0)).rejects.toThrow('Invalid item image')
    await expect(cache.get('T7_POTION_REVIVE', 0)).resolves.toContain('data:image/png;base64,')
    await cache.get('T7_POTION_REVIVE', 1)
    expect(fetchImage).toHaveBeenCalledTimes(3)
  })

  it('rejects paths, URLs and unsupported qualities before fetching', async () => {
    const fetchImage = vi.fn()
    vi.stubGlobal('fetch', fetchImage)
    const cache = new ItemImageCache(directory)
    for (const id of ['../secret', 'https://example.com/image', '']) {
      await expect(cache.get(id, 1)).rejects.toThrow('Invalid item image request')
    }
    await expect(cache.get('T4_BAG', 6)).rejects.toThrow('Invalid item image request')
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it('automatically retries temporary render failures with the full enchanted shapeshifter ID', async () => {
    const fetchImage = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(png))
    vi.stubGlobal('fetch', fetchImage)
    const cache = new ItemImageCache(directory)
    await expect(cache.get('T5_2H_SHAPESHIFTER_SET1@2', 3)).resolves.toContain('data:image/png;base64,')
    expect(fetchImage).toHaveBeenCalledTimes(2)
    const url = fetchImage.mock.calls[1][0] as URL
    expect(decodeURIComponent(url.pathname)).toBe('/v1/item/T5_2H_SHAPESHIFTER_SET1@2.png')
    expect(url.searchParams.get('quality')).toBe('3')
    await cache.get('T5_2H_SHAPESHIFTER_SET1@2', 3)
    expect(fetchImage).toHaveBeenCalledTimes(2)
  })

  it('limits concurrent inventory downloads and releases slots after errors', async () => {
    let active = 0
    let peak = 0
    const fetchImage = vi.fn(async (url: URL) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return url.pathname.includes('MISSING') ? new Response('missing', { status: 404 }) : new Response(png)
    })
    vi.stubGlobal('fetch', fetchImage)
    const cache = new ItemImageCache(directory)
    const results = await Promise.allSettled([
      cache.get('T4_MISSING', 1),
      ...Array.from({ length: 12 }, (_, index) => cache.get(`T4_ITEM_${index}`, 1))
    ])
    expect(peak).toBeLessThanOrEqual(4)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(12)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })
})
