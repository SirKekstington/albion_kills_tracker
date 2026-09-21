import type {
  AlbionEvent,
  CollectorStatus,
  EventType,
  PlayerProfile,
  StoredEvent
} from '../shared/types'
import { AlbionApi } from './albion-api'
import { AppDatabase } from './database'
import { PriceService, PRICING_METHOD } from './price-service'

export class EventCollector {
  private timer: NodeJS.Timeout | null = null
  private status: CollectorStatus = {
    running: false,
    syncing: false,
    lastSyncAt: null,
    lastError: null,
    nextSyncAt: null
  }

  constructor(
    private readonly db: AppDatabase,
    private readonly api: AlbionApi,
    private readonly prices: PriceService,
    private onUpdated: () => void
  ) {}

  start(): void {
    this.stop()
    this.status.running = true
    void this.refresh()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.status.running = false
    this.status.nextSyncAt = null
  }

  restart(): void {
    this.start()
  }

  getStatus(): CollectorStatus {
    return { ...this.status }
  }

  async refresh(): Promise<CollectorStatus> {
    if (this.status.syncing) return this.getStatus()
    const profile = this.db.getActiveProfile()
    if (!profile) {
      this.scheduleNext()
      return this.getStatus()
    }

    this.status.syncing = true
    this.status.lastError = null
    this.onUpdated()
    try {
      // Convert historical snapshots gradually; preserve manual no-loss / inventory-only choices.
      for (const stored of this.db.listLegacyPricedEvents(profile.id)) {
        const raw = JSON.parse(stored.rawJson) as AlbionEvent
        if (!raw.Victim) continue
        const value = await this.prices.calculateVictimValue(profile.server, raw.Victim)
        const inventoryValue = await this.prices.calculateVictimValue(profile.server, { Inventory: raw.Victim.Inventory })
        this.db.updateEventPrices(profile.id, stored.eventId, value, inventoryValue)
      }
      const results = await Promise.allSettled([
        this.api.getRecentGlobalEvents(profile.server),
        this.api.getRecentPlayerEvents(profile.server, profile.id, 'kills'),
        this.api.getRecentPlayerEvents(profile.server, profile.id, 'deaths')
      ])
      const events = deduplicate(
        results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
      )
      if (!events.length && results.every((result) => result.status === 'rejected')) {
        throw new Error('Albion API ist derzeit nicht erreichbar.')
      }
      for (const event of events) await this.processEvent(profile, event)
      this.status.lastSyncAt = Date.now()
    } catch (error) {
      this.status.lastError = error instanceof Error ? error.message : 'Unbekannter Sync-Fehler'
    } finally {
      this.status.syncing = false
      this.scheduleNext()
      this.onUpdated()
    }
    return this.getStatus()
  }

  private async processEvent(profile: PlayerProfile, event: AlbionEvent): Promise<void> {
    const type = classifyEvent(event, profile.id)
    const eventId = String(event.EventId)
    if (!type || this.db.hasEvent(profile.id, eventId)) return

    const estimatedValue = await this.prices.calculateVictimValue(profile.server, event.Victim)
    const stored: StoredEvent = {
      pricingMethod: PRICING_METHOD,
      eventId,
      profileId: profile.id,
      timestamp: Date.parse(event.TimeStamp) || Date.now(),
      type,
      killerName: event.Killer?.Name ?? 'Unknown',
      victimName: event.Victim?.Name ?? 'Unknown',
      killFame: event.TotalVictimKillFame ?? 0,
      estimatedValue,
      pricingTimestamp: Date.now(),
      rawJson: JSON.stringify(event)
    }
    this.db.insertEvent(stored)
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer)
    if (!this.status.running) return
    const delay = Math.max(10, this.db.getSettings().refreshSeconds) * 1000
    this.status.nextSyncAt = Date.now() + delay
    this.timer = setTimeout(() => void this.refresh(), delay)
  }
}

export function classifyEvent(event: AlbionEvent, playerId: string): EventType | null {
  if (event.Victim?.Id === playerId) return 'DEATH'
  if (event.Killer?.Id === playerId) return 'KILL'
  if (event.Participants?.some((participant) => participant.Id === playerId)) return 'ASSIST'
  return null
}

function deduplicate(events: AlbionEvent[]): AlbionEvent[] {
  return [...new Map(events.map((event) => [String(event.EventId), event])).values()]
}
