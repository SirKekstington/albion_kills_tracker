import type { AlbionEvent, CollectorStatus, EventType, PlayerProfile, StoredEvent } from '../shared/types'
import { parseUtcTimestamp, PENDING_PRICING_METHOD } from '../shared/pricing'
import { AlbionApi } from './albion-api'
import { AppDatabase, getRangeStart } from './database'
import { PriceService } from './price-service'
import { Diagnostics } from './diagnostics'

export class EventCollector {
  private timer: NodeJS.Timeout | null = null
  private pricingTimer: NodeJS.Timeout | null = null
  private pricing = false
  private generation = 0
  private readonly retries = new Map<string, number>()
  private status: CollectorStatus = {
    running: false, syncing: false, lastSyncAt: null, lastError: null, nextSyncAt: null
  }

  constructor(
    private readonly db: AppDatabase,
    private readonly api: AlbionApi,
    private readonly prices: PriceService,
    private onUpdated: () => void,
    private readonly diagnostics = new Diagnostics()
  ) {}

  start(): void {
    this.stop()
    this.status.running = true
    void this.refresh()
  }
  stop(): void {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    if (this.pricingTimer) clearTimeout(this.pricingTimer)
    this.timer = this.pricingTimer = null
    this.status.running = false
    this.status.nextSyncAt = null
  }
  restart(): void { this.start() }
  getStatus(): CollectorStatus { return { ...this.status } }

  async refresh(): Promise<CollectorStatus> {
    if (this.status.syncing) return this.getStatus()
    const profile = this.db.getActiveProfile()
    if (!profile) { this.scheduleNext(); return this.getStatus() }
    const generation = this.generation
    this.status.syncing = true
    this.status.lastError = null
    this.onUpdated()
    try {
      const tracking = this.db.getProfitTracking(profile.id)
      const since = tracking.mode === 'SESSION' && tracking.startedAt !== null ? tracking.startedAt : getRangeStart('TODAY')!
      this.diagnostics.log('info', 'collector', 'Import started', { profile, tracking, since })
      const sources = ['global', 'kills', 'deaths']
      const results = await Promise.allSettled([
        this.api.getRecentGlobalEvents(profile.server, since, profile.id),
        this.api.getRecentPlayerEvents(profile.server, profile.id, 'kills', since),
        this.api.getRecentPlayerEvents(profile.server, profile.id, 'deaths', since)
      ])
      if (generation !== this.generation) return this.getStatus()
      const failures: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failures.push(`${sources[index]}: ${String(result.reason)}`)
          this.diagnostics.log('error', 'collector', 'Source failed', { source: sources[index], error: String(result.reason) })
        }
      })
      const events = deduplicate(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []))
      let inserted = 0
      for (const event of events) {
        try { if (this.storeEvent(profile, event)) inserted += 1 }
        catch (error) { this.diagnostics.log('error', 'collector', 'Event could not be stored', { eventId: event.EventId, error: String(error) }); failures.push(String(error)) }
      }
      this.status.lastError = failures.length ? failures.join('; ') : null
      if (results.some((result) => result.status === 'fulfilled')) this.status.lastSyncAt = Date.now()
      this.diagnostics.log('info', 'collector', 'Import finished', { received: events.length, inserted, failedSources: failures.length })
    } catch (error) {
      this.status.lastError = String(error)
      this.diagnostics.log('error', 'collector', 'Import failed', { error: String(error) })
    } finally {
      this.status.syncing = false
      this.scheduleNext()
      this.onUpdated()
      if (generation === this.generation) void this.pricePending()
    }
    return this.getStatus()
  }

  async importEvent(eventId: string): Promise<boolean> {
    const profile = this.db.getActiveProfile()
    if (!profile) throw new Error('No active character')
    const event = await this.api.getEvent(profile.server, eventId)
    if (!classifyEvent(event, profile.id)) throw new Error('Active character is not a participant in this event')
    const stored = this.storeEvent(profile, event)
    this.onUpdated()
    void this.pricePending()
    return stored
  }

  private storeEvent(profile: PlayerProfile, event: AlbionEvent): boolean {
    const type = classifyEvent(event, profile.id)
    if (!type) return false
    const eventId = String(event.EventId)
    const timestamp = parseUtcTimestamp(event.TimeStamp)
    if (!Number.isFinite(timestamp) || !/^\d+$/.test(eventId)) throw new Error(`Invalid event identity or timestamp: ${eventId}`)
    const tracking = this.db.getProfitTracking(profile.id)
    const cutoff = tracking.mode === 'SESSION' ? tracking.startedAt ?? 0 : getRangeStart('TODAY')!
    const stored: StoredEvent = {
      pricingMethod: PENDING_PRICING_METHOD, eventId, profileId: profile.id, timestamp, type,
      killerName: event.Killer?.Name ?? 'Unknown', victimName: event.Victim?.Name ?? 'Unknown',
      killFame: event.TotalVictimKillFame ?? 0, estimatedValue: 0, pricingTimestamp: 0, rawJson: JSON.stringify(event)
    }
    const inserted = this.db.insertEvent(stored)
    this.diagnostics.log('info', 'event', inserted ? 'Event saved before pricing' : 'Event already stored', {
      eventId, type, timestamp, cutoff, included: timestamp >= cutoff,
      reason: timestamp < cutoff ? 'Before tracking start' : type === 'ASSIST' ? 'Assist: visible, excluded from net profit' : 'Included in tracking'
    })
    return inserted
  }

  async pricePending(): Promise<void> {
    if (this.pricing) return
    const profile = this.db.getActiveProfile()
    if (!profile) return
    this.pricing = true
    const generation = this.generation
    try {
      for (const [key, until] of this.retries) if (until <= Date.now()) this.retries.delete(key)
      const prefix = profile.id + ':'
      const excluded = [...this.retries.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))
      for (const stored of this.db.listPendingPricedEvents(profile.id, excluded)) {
        if (generation !== this.generation) break
        try {
          const raw = JSON.parse(stored.rawJson) as AlbionEvent
          if (!raw?.Victim) throw new Error('Missing victim data for valuation')
          const value = await this.prices.calculateVictimValue(profile.server, raw.Victim)
          const inventoryValue = await this.prices.calculateVictimValue(profile.server, { Inventory: raw.Victim.Inventory })
          if (generation !== this.generation) break
          this.db.updateEventPrices(profile.id, stored.eventId, value, inventoryValue)
          this.diagnostics.log('info', 'pricing', 'Fight valued', { eventId: stored.eventId, value, inventoryValue })
          this.onUpdated()
        } catch (error) {
          this.retries.set(prefix + stored.eventId, Date.now() + 60000)
          this.diagnostics.log('error', 'pricing', 'Valuation deferred; fight retained, retry in 60 seconds', { eventId: stored.eventId, error: String(error) })
        }
      }
    } catch (error) {
      this.diagnostics.log('error', 'pricing', 'Pricing queue failed', { error: String(error) })
    } finally {
      this.pricing = false
      if (this.status.running) {
        if (this.pricingTimer) clearTimeout(this.pricingTimer)
        this.pricingTimer = setTimeout(() => void this.pricePending(), 3000)
      }
    }
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer)
    if (!this.status.running) return
    const wait = Math.max(10, this.db.getSettings().refreshSeconds) * 1000
    this.status.nextSyncAt = Date.now() + wait
    this.timer = setTimeout(() => void this.refresh(), wait)
  }
}

export function classifyEvent(event: AlbionEvent, playerId: string): EventType | null {
  if (event.Victim?.Id === playerId) return 'DEATH'
  if (event.Killer?.Id === playerId) return 'KILL'
  if (event.Participants?.some((participant) => participant.Id === playerId)) return 'ASSIST'
  return null
}

export function deduplicate(events: AlbionEvent[]): AlbionEvent[] {
  const combined = new Map<string, AlbionEvent>()
  for (const event of events) {
    const id = String(event.EventId)
    const previous = combined.get(id)
    if (!previous) { combined.set(id, event); continue }
    const participants = new Map((previous.Participants ?? []).map((player) => [player.Id ?? player.Name, player]))
    for (const player of event.Participants ?? []) participants.set(player.Id ?? player.Name, { ...participants.get(player.Id ?? player.Name), ...player })
    combined.set(id, { ...previous, ...event, Killer: event.Killer ?? previous.Killer, Victim: event.Victim ?? previous.Victim, Participants: [...participants.values()] })
  }
  return [...combined.values()]
}
