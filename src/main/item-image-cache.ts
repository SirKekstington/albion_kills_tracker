import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

// Successful images never expire. Failed downloads are not persisted.
export class ItemImageCache {
  private readonly pending = new Map<string, Promise<string>>()
  private activeDownloads = 0
  private readonly downloadQueue: Array<() => void> = []

  constructor(private readonly directory: string) {}

  get(itemId: string, quality: number): Promise<string> {
    if (!/^[A-Za-z0-9_@.-]{1,200}$/.test(itemId) || !Number.isInteger(quality) || quality < 0 || quality > 5) {
      return Promise.reject(new Error('Invalid item image request'))
    }
    // Consumables can have quality 0 in events; render them as normal quality.
    const renderQuality = Math.max(1, quality)
    const key = createHash('sha256').update(`${itemId}:${renderQuality}`).digest('hex')
    const existing = this.pending.get(key)
    if (existing) return existing
    const request = this.load(key, itemId, renderQuality).finally(() => this.pending.delete(key))
    this.pending.set(key, request)
    return request
  }

  private async load(key: string, itemId: string, quality: number): Promise<string> {
    const path = join(this.directory, `${key}.png`)
    let image: Buffer | undefined
    try {
      const cached = await readFile(path)
      if (isPng(cached)) image = cached
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!image) {
      image = await this.download(itemId, quality)
      await mkdir(this.directory, { recursive: true })
      await writeFile(`${path}.tmp`, image)
      await rename(`${path}.tmp`, path)
    }
    return `data:image/png;base64,${image.toString('base64')}`
  }

  private async download(itemId: string, quality: number): Promise<Buffer> {
    // Opening inventories must not flood the render service with parallel requests.
    if (this.activeDownloads >= 4) await new Promise<void>((resolve) => this.downloadQueue.push(resolve))
    else this.activeDownloads += 1
    try {
      const url = new URL(`https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png`)
      url.searchParams.set('quality', String(quality))
      url.searchParams.set('locale', 'en')
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response: Response
        try {
          response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        } catch (error) {
          if (attempt === 2) throw error
          await delay(500 * 2 ** attempt)
          continue
        }
        if (!response.ok) {
          await response.body?.cancel()
          if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
            await delay(500 * 2 ** attempt)
            continue
          }
          throw new Error(`Item image HTTP ${response.status}`)
        }
        const image = Buffer.from(await response.arrayBuffer())
        if (!isPng(image)) throw new Error('Invalid item image')
        return image
      }
      throw new Error('Item image download failed')
    } finally {
      const next = this.downloadQueue.shift()
      if (next) next()
      else this.activeDownloads -= 1
    }
  }
}

function isPng(image: Buffer): boolean {
  return image.length > 8 && image.length <= 5 * 1024 * 1024 && image.subarray(0, 8).equals(PNG_SIGNATURE)
}
