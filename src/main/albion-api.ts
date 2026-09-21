import { z } from 'zod'
import type { AlbionEvent, AlbionServer, PlayerSearchResult } from '../shared/types'
import { SERVERS } from './servers'

const searchResponseSchema = z.object({
  players: z.array(z.object({
    Id: z.string(),
    Name: z.string(),
    GuildName: z.string().optional().nullable(),
    AllianceName: z.string().optional().nullable()
  })).default([])
})

export class AlbionApi {
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

  async getRecentGlobalEvents(server: AlbionServer): Promise<AlbionEvent[]> {
    return this.getJson(`${SERVERS[server].gameInfoBaseUrl}/events?limit=51&offset=0`)
  }

  async getRecentPlayerEvents(
    server: AlbionServer,
    playerId: string,
    kind: 'kills' | 'deaths'
  ): Promise<AlbionEvent[]> {
    return this.getJson(
      `${SERVERS[server].gameInfoBaseUrl}/players/${encodeURIComponent(playerId)}/${kind}?limit=50&offset=0`
    )
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Albion-PvP-Tracker/0.1' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) throw new Error(`Albion API antwortet mit HTTP ${response.status}`)
    return response.json() as Promise<T>
  }
}
