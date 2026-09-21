import type {
  AlbionEvent,
  FightDetails,
  DashboardData,
  DashboardStats,
  FightSummary,
  StoredEvent,
  TimeRange,
  ValuationMode
} from '../shared/types'
import { EMPTY_STATS } from '../shared/types'
import { AppDatabase } from './database'
import type { PriceService } from './price-service'

export class StatisticsService {
  constructor(private readonly db: AppDatabase) {}

  async setFightValuation(eventId: string, mode: ValuationMode, prices: PriceService): Promise<FightDetails> {
    const profile = this.db.getActiveProfile()
    const event = profile ? this.db.getEvent(profile.id, eventId) : null
    if (!profile || !event) throw new Error('Fight not found for active character')
    let value = 0
    if (mode === 'INVENTORY') {
      const raw = JSON.parse(event.rawJson) as AlbionEvent
      if (!Array.isArray(raw.Victim?.Inventory)) throw new Error('Inventory data is unavailable for this fight')
      value = await prices.calculateVictimValue(profile.server, { Inventory: raw.Victim.Inventory })
    }
    this.db.setEventValuation(profile.id, eventId, mode, value)
    return toFightDetails(this.db.getEvent(profile.id, eventId)!)
  }

  getFightDetails(eventId: string): FightDetails | null {
    const profile = this.db.getActiveProfile()
    if (!profile) return null
    const event = this.db.getEvent(profile.id, eventId)
    return event ? toFightDetails(event) : null
  }

  getDashboard(range: TimeRange, collector: DashboardData['collector']): DashboardData {
    const profile = this.db.getActiveProfile()
    if (!profile) {
      return { profile: null, range, stats: { ...EMPTY_STATS }, recentFights: [], collector }
    }
    const events = this.db.listEvents(profile.id, range)
    return {
      profile,
      range,
      stats: calculateStats(events),
      recentFights: events.slice(0, 30).map(toFightSummary),
      collector
    }
  }

  getTodayStats(): DashboardStats {
    const profile = this.db.getActiveProfile()
    if (!profile) return { ...EMPTY_STATS }
    return calculateStats(this.db.listEvents(profile.id, 'TODAY'))
  }
}

export function calculateStats(events: StoredEvent[]): DashboardStats {
  const stats = { ...EMPTY_STATS }
  for (const event of events) {
    const value = accountedValue(event)
    if (event.type === 'KILL') {
      stats.kills += 1
      stats.killValue += value
    } else if (event.type === 'ASSIST') {
      stats.assists += 1
      stats.assistValue += value
    } else {
      stats.deaths += 1
      stats.lossValue += value
    }
  }
  stats.profit = stats.killValue - stats.lossValue
  return stats
}

function toFightSummary(event: StoredEvent): FightSummary {
  let raw: AlbionEvent | null = null
  try { raw = JSON.parse(event.rawJson) as AlbionEvent | null } catch { /* Keep the history available for old malformed events. */ }
  const player = event.type === 'DEATH' ? raw?.Victim : event.type === 'KILL' ? raw?.Killer
    : raw?.Participants?.find((participant) => participant.Id === event.profileId)
  const opponent = event.type === 'DEATH' ? raw?.Killer : raw?.Victim
  return {
    playerWeapon: player?.Equipment?.MainHand ?? null,
    opponentWeapon: opponent?.Equipment?.MainHand ?? null,
    valuationMode: event.valuationMode ?? 'FULL',
    eventId: event.eventId,
    timestamp: event.timestamp,
    type: event.type,
    opponentName: event.type === 'DEATH' ? event.killerName : event.victimName,
    estimatedValue: accountedValue(event),
    killFame: event.killFame
  }
}

export function toFightDetails(event: StoredEvent): FightDetails {
  const raw = JSON.parse(event.rawJson) as AlbionEvent | null
  const killer = raw?.Killer ?? null
  const victim = raw?.Victim ?? null
  const participants = raw?.Participants ?? []
  const player = event.type === 'DEATH' ? victim : event.type === 'KILL' ? killer
    : participants.find((participant) => participant.Id === event.profileId) ?? null
  const seen = new Set<string>()
  const assists = participants.filter((participant) => {
    if (participant.Id && (participant.Id === killer?.Id || participant.Id === victim?.Id)) return false
    const key = participant.Id || participant.Name
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    ...toFightSummary(event), pricingTimestamp: event.valuationTimestamp ?? event.pricingTimestamp,
    originalValue: event.estimatedValue,
    player, opponent: event.type === 'DEATH' ? killer : victim, killer, victim, assists
  }
}

function accountedValue(event: StoredEvent): number {
  return event.valuationMode === 'NONE' ? 0 : event.valuationMode === 'INVENTORY'
    ? event.adjustedValue ?? 0 : event.estimatedValue
}
