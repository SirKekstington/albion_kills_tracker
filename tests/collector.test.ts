import { describe, expect, it, vi } from 'vitest'
import { EventCollector, classifyEvent, deduplicate } from '../src/main/event-collector'
import { Diagnostics } from '../src/main/diagnostics'
import { parseUtcTimestamp, PRICING_METHOD } from '../src/shared/pricing'
import type { AlbionEvent, StoredEvent } from '../src/shared/types'
import type { AppDatabase } from '../src/main/database'
import type { AlbionApi } from '../src/main/albion-api'
import type { PriceService } from '../src/main/price-service'

const playerId = '__yowWVlQX-9VK_gGcAMlQ'
const fixture = (id: number, time: string): AlbionEvent => ({ EventId: id, TimeStamp: time,
  Killer: { Id: 'killer', Name: 'TaubsenLive' }, Victim: { Id: `victim-${id}`, Name: 'Victim' },
  Participants: [{ Id: 'killer' }, { Id: playerId, Name: 'MrKekstein' }], TotalVictimKillFame: 100 })
const first = fixture(437474461, '2026-09-21T14:00:18.289327500Z')
const second = fixture(437475665, '2026-09-21T14:03:10.128894400Z')

function setup(events: AlbionEvent[], calculate: PriceService['calculateVictimValue']) {
  const stored = new Map<string, StoredEvent>()
  const diagnostics = new Diagnostics(true)
  const db = {
    getActiveProfile: () => ({ id: playerId, name: 'MrKekstein', server: 'EUROPE' }),
    getProfitTracking: () => ({ mode: 'SESSION', startedAt: 1789999636761 }),
    insertEvent: (event: StoredEvent) => { if (stored.has(event.eventId)) return false; stored.set(event.eventId, event); return true },
    listPendingPricedEvents: (_: string, excluded: string[] = []) => [...stored.values()].filter((event) => event.pricingMethod === 'PENDING' && !excluded.includes(event.eventId)),
    updateEventPrices: (_: string, id: string, value: number) => { stored.set(id, { ...stored.get(id)!, estimatedValue: value, pricingMethod: PRICING_METHOD }) }
  } as unknown as AppDatabase
  const api = { getRecentGlobalEvents: async () => events, getRecentPlayerEvents: async () => [] } as unknown as AlbionApi
  const collector = new EventCollector(db, api, { calculateVictimValue: calculate } as PriceService, () => {}, diagnostics)
  return { collector, stored, diagnostics, api }
}

describe('event import and session diagnosis', () => {
  it('stores the two reported assists immediately even while the market API is blocked', async () => {
    let unblock!: (value: number) => void
    const pending = new Promise<number>((resolve) => { unblock = resolve })
    const { collector, stored, diagnostics } = setup([first, second], async () => pending)
    await collector.refresh()
    expect([...stored.keys()]).toEqual(['437474461', '437475665'])
    expect(stored.get('437474461')?.pricingMethod).toBe('PENDING')
    expect(collector.getStatus().syncing).toBe(false)
    const decisions = diagnostics.snapshot().filter((entry) => entry.scope === 'event')
    expect(decisions.every((entry) => entry.data?.included === false)).toBe(true)
    expect(decisions.every((entry) => entry.data?.reason === 'Before tracking start')).toBe(true)
    unblock(100)
    await vi.waitFor(() => expect(stored.get('437475665')?.pricingMethod).toBe(PRICING_METHOD))
    expect(stored.get('437475665')?.type).toBe('ASSIST')
  })

  it('retains events and continues valuing later events after one price failure', async () => {
    const { collector, stored, diagnostics } = setup([first, second], async (_, victim) => {
      if (victim?.Id === first.Victim?.Id) throw new Error('Market HTTP 503')
      return 500
    })
    await collector.refresh()
    await vi.waitFor(() => expect(stored.get('437475665')?.estimatedValue).toBe(500))
    expect(stored.get('437474461')?.pricingMethod).toBe('PENDING')
    expect(diagnostics.snapshot().some((entry) => entry.level === 'error' && entry.data?.eventId === '437474461')).toBe(true)
    await collector.refresh()
    expect(stored.size).toBe(2)
  })

  it('does not let an invalid timestamp or a failed endpoint discard other events', async () => {
    const { collector, stored, api } = setup([{ ...first, TimeStamp: 'invalid' }, second], async () => 0)
    api.getRecentPlayerEvents = async () => { throw new Error('HTTP 502') }
    await collector.refresh()
    expect(stored.has('437475665')).toBe(true)
    expect(stored.has('437474461')).toBe(false)
    expect(collector.getStatus().lastError).toContain('HTTP 502')
  })

  it('merges participation from duplicate sources and treats timezone-free API times as UTC', () => {
    const merged = deduplicate([first, { ...first, Participants: [] }])
    expect(classifyEvent(merged[0], playerId)).toBe('ASSIST')
    expect(parseUtcTimestamp('2026-09-21T14:00:18.289')).toBe(parseUtcTimestamp(first.TimeStamp))
    expect(parseUtcTimestamp('2026-09-21T16:00:18.289+02:00')).toBe(parseUtcTimestamp(first.TimeStamp))
  })

  it('keeps development logs bounded and stores nothing in release mode', () => {
    const release = new Diagnostics(false)
    release.log('error', 'test', 'secret')
    expect(release.snapshot()).toEqual([])
    const dev = new Diagnostics(true)
    for (let i = 0; i < 600; i++) dev.log('info', 'test', String(i))
    expect(dev.snapshot()).toHaveLength(500)
    expect(dev.snapshot()[0].message).toBe('599')
  })
})
