import { describe, expect, it } from 'vitest'
import type { AlbionEvent, StoredEvent } from '../src/shared/types'
import { getRangeStart } from '../src/main/database'
import { classifyEvent } from '../src/main/event-collector'
import { median } from '../src/main/price-service'
import { calculateStats, StatisticsService, toFightDetails } from '../src/main/statistics-service'
import type { AppDatabase } from '../src/main/database'

const playerId = 'player-1'

describe('median pricing', () => {
  it('uses the middle city price for odd counts', () => {
    expect(median([455_000, 409_000, 420_000, 412_000, 435_000])).toBe(420_000)
  })

  it('averages both middle values for even counts', () => {
    expect(median([100, 300, 200, 400])).toBe(250)
  })
})

describe('event classification', () => {
  it.each([
    [{ Victim: { Id: playerId } }, 'DEATH'],
    [{ Killer: { Id: playerId } }, 'KILL'],
    [{ Participants: [{ Id: playerId }] }, 'ASSIST'],
    [{ Killer: { Id: 'someone-else' } }, null]
  ])('classifies involvement', (partial, expected) => {
    const event = { EventId: 1, TimeStamp: new Date().toISOString(), ...partial } as AlbionEvent
    expect(classifyEvent(event, playerId)).toBe(expected)
  })
})

describe('statistics', () => {
  it('excludes protected gear while retaining fight counts and the original estimates', () => {
    const noLoss = { ...event('DEATH', 135_407_077), valuationMode: 'NONE' as const }
    const inventoryOnly = { ...event('DEATH', 10_000_000), valuationMode: 'INVENTORY' as const, adjustedValue: 50_000 }
    const safeKill = { ...event('KILL', 4_000_000), valuationMode: 'NONE' as const }
    const safeAssist = { ...event('ASSIST', 7_000_000), valuationMode: 'INVENTORY' as const, adjustedValue: 12_000 }
    expect(calculateStats([noLoss, inventoryOnly, safeKill, safeAssist])).toEqual({
      kills: 1, assists: 1, deaths: 2, killValue: 0, assistValue: 12_000, lossValue: 50_000, profit: -50_000
    })
    expect(toFightDetails(noLoss)).toMatchObject({ estimatedValue: 0, originalValue: 135_407_077, valuationMode: 'NONE' })
    expect(calculateStats([{ ...noLoss, valuationMode: 'FULL' }]).lossValue).toBe(135_407_077)
  })
  it('excludes assist value from profit', () => {
    const events = [event('KILL', 29_000_000), event('ASSIST', 12_000_000), event('DEATH', 8_400_000)]
    expect(calculateStats(events)).toEqual({
      kills: 1,
      assists: 1,
      deaths: 1,
      killValue: 29_000_000,
      assistValue: 12_000_000,
      lossValue: 8_400_000,
      profit: 20_600_000
    })
  })
})

describe('local day boundary', () => {
  it('starts TODAY at local midnight', () => {
    const now = new Date(2026, 8, 21, 14, 35, 0)
    const start = new Date(getRangeStart('TODAY', now)!)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getDate()).toBe(21)
  })
})

describe('fight details', () => {
  const killer = { Id: 'killer', Name: 'Killer', Equipment: { MainHand: { Type: 'T6_MAIN_SWORD', Quality: 3 } } }
  const victim = { Id: 'victim', Name: 'Victim', Equipment: { Armor: { Type: 'T5_ARMOR_PLATE_SET1' } } }
  const helper = { Id: playerId, Name: 'Helper', Equipment: { Shoes: { Type: 'T4_SHOES_CLOTH_SET1' } } }

  it.each([
    ['KILL', killer.Id, killer, victim],
    ['DEATH', victim.Id, victim, killer],
    ['ASSIST', helper.Id, helper, victim]
  ] as const)('selects the historical equipment for %s', (type, profileId, player, opponent) => {
    const stored = {
      ...event(type, 123456), profileId, killFame: 98765,
      rawJson: JSON.stringify({ Killer: killer, Victim: victim, Participants: [killer, helper, helper, victim] })
    }
    const result = toFightDetails(stored)
    expect(result.player).toEqual(player)
    expect(result.opponent).toEqual(opponent)
    expect(result.assists).toEqual([helper])
    expect(result.estimatedValue).toBe(123456)
    expect(result.killFame).toBe(98765)
    expect(result.pricingTimestamp).toBe(stored.pricingTimestamp)
  })

  it('keeps unavailable gear distinguishable from empty equipment', () => {
    const result = toFightDetails({ ...event('ASSIST', 0), rawJson: JSON.stringify({ Killer: killer, Victim: victim }) })
    expect(result.player).toBeNull()
    expect(result.assists).toEqual([])
    expect(result.opponent).toEqual(victim)
    expect(toFightDetails(event('KILL', 0)).player).toBeNull()
  })

  it('looks up details only for the active profile', () => {
    const db = {
      getActiveProfile: () => ({ id: playerId }),
      getEvent: (profileId: string, eventId: string) => {
        expect(profileId).toBe(playerId)
        expect(eventId).toBe('missing')
        return null
      }
    } as unknown as AppDatabase
    expect(new StatisticsService(db).getFightDetails('missing')).toBeNull()
  })
})

function event(type: StoredEvent['type'], estimatedValue: number): StoredEvent {
  return {
    eventId: crypto.randomUUID(),
    profileId: playerId,
    timestamp: Date.now(),
    type,
    killerName: 'Killer',
    victimName: 'Victim',
    killFame: 0,
    estimatedValue,
    pricingTimestamp: Date.now(),
    rawJson: '{}'
  }
}
