import { z } from 'zod'
import type { AlbionEvent, AlbionServer, PlayerSearchResult } from '../shared/types'
import { SERVERS } from './servers'
import { Diagnostics } from './diagnostics'
import { parseUtcTimestamp } from '../shared/pricing'

const searchResponseSchema = z.object({
  players: z.array(z.object({
    Id: z.string(),
    Name: z.string(),
    GuildName: z.string().optional().nullable(),
    AllianceName: z.string().optional().nullable()
  })).default([])
})

export class AlbionApi {
  private readonly cursors = new Map<string, number>()
  constructor(private readonly diagnostics = new Diagnostics()) {}
  async searchPlayers(server: AlbionServer, query: string): Promise<PlayerSearchResult[]> {
    const data = await this.getJson(
      `${SERVERS[server].gameInfoBaseUrl}/search?q=${encodeURIComponent(query.trim())}`
    )
    const parsed = searchResponseSchema.parse(data)
    return parsed.players.map((player) => ({
      id: player.Id,
      name: player.Name,
      guildName: player.GuildName ?? undefined,
      allianceName: player.AllianceName ?? undefined,
      server
    }))
  }

  async getRecentGlobalEvents(server: AlbionServer, since?: number, profileId = ''): Promise<AlbionEvent[]> {
    const base = `${SERVERS[server].gameInfoBaseUrl}/events`
    return this.getEventPages(base, since, `${base}:${profileId}`)
  }

  async getRecentPlayerEvents(
    server: AlbionServer,
    playerId: string,
    kind: 'kills' | 'deaths',
    since?: number
  ): Promise<AlbionEvent[]> {
    return this.getEventPages(
      `${SERVERS[server].gameInfoBaseUrl}/players/${encodeURIComponent(playerId)}/${kind}`, since
    )
  }

  async getEvent(server: AlbionServer, eventId: string): Promise<AlbionEvent> {
    return this.getJson(`${SERVERS[server].gameInfoBaseUrl}/events/${encodeURIComponent(eventId)}`)
  }

  private async getEventPages(base: string, since = Date.now() - 86400000, cursorKey = base): Promise<AlbionEvent[]> {
    const started = Date.now()
    const cutoff = (this.cursors.get(cursorKey) ?? since) - 120000
    const events: AlbionEvent[] = []
    const seen = new Set<string>()
    // The public API has a finite recent window; report when its pagination limit is reached.
    for (let offset = 0; offset < 1000; offset += 50) {
      let page: AlbionEvent[]
      try {
        page = await this.getJson(`${base}?limit=50&offset=${offset}`)
        if (!Array.isArray(page)) throw new Error('Invalid event list response')
      } catch (error) {
        this.diagnostics.log('error', 'events', 'Event page failed', { base, offset, error: String(error) })
        if (!events.length) throw error
        return events
      }
      let added = 0
      for (const event of page) {
        const id = String(event.EventId)
        if (seen.has(id)) continue
        seen.add(id); events.push(event); added += 1
      }
      this.diagnostics.log('info', 'events', 'Event page received', { base, offset, received: page.length, added, cutoff })
      if (page.length < 50 || page.some((event) => parseUtcTimestamp(event.TimeStamp) <= cutoff)) {
        this.cursors.set(cursorKey, started)
        return events
      }
      if (!added) {
        this.diagnostics.log('warn', 'events', 'Pagination returned repeated events; coverage may be incomplete', { base, offset })
        return events
      }
    }
    this.diagnostics.log('warn', 'events', 'Recent event window exhausted; older assists may be unavailable', { base, cutoff })
    return events
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Albion-PvP-Tracker/0.1' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`Albion API HTTP ${response.status}`)
    return response.json() as Promise<T>
  }
}
