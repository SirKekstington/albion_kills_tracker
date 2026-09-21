// Run with the Electron Node runtime: better-sqlite3 is compiled for Electron.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from '../src/main/database'
import { StatisticsService } from '../src/main/statistics-service'
import type { PriceService } from '../src/main/price-service'
import type { StoredEvent } from '../src/shared/types'

async function main(): Promise<void> {
  const path = join(tmpdir(), `albion-valuation-${randomUUID()}.db`)
  let db = new AppDatabase(path)
  try {
    db.saveProfile({ id: 'a', name: 'A', server: 'EUROPE' })
    const settings = db.getSettings()
    assert.equal(settings.language, 'en')
    assert.equal(settings.overlayCustomEnabled, false)
    db.saveSettings({ ...settings, overlayTransparent: true, overlayCustomEnabled: true,
      overlayHtml: '<b>{{profit}}</b>', overlayCss: 'b { color: red; }' })
    db.setLanguage('de')
    const event: StoredEvent = {
      eventId: '1', profileId: 'a', timestamp: Date.now(), type: 'DEATH',
      killerName: 'B', victimName: 'A', killFame: 100, estimatedValue: 135_407_077,
      pricingTimestamp: 1234,
      rawJson: JSON.stringify({ Victim: { Inventory: [{ Type: 'T4_RUNE', Count: 4 }], Equipment: { Head: { Type: 'T8_HEAD_PLATE_SET1' } } } })
    }
    db.insertEvent(event)
    let service = new StatisticsService(db)
    const prices = { calculateVictimValue: async (server: string, victim: unknown) => {
      assert.equal(server, 'EUROPE')
      assert.deepEqual(victim, { Inventory: [{ Type: 'T4_RUNE', Count: 4 }] })
      return 500
    } } as PriceService
    await service.setFightValuation('1', 'NONE', prices)
    assert.equal(service.getTodayStats().lossValue, 0)
    assert.equal(db.listEvents('a', 'ALL')[0].valuationMode, 'NONE')
    db.close()
    db = new AppDatabase(path)
    assert.equal(db.getSettings().language, 'de')
    assert.equal(db.getSettings().overlayHtml, '<b>{{profit}}</b>')
    assert.equal(db.getSettings().overlayCss, 'b { color: red; }')
    assert.equal(db.getSettings().overlayTransparent, true)
    service = new StatisticsService(db)
    assert.equal(service.getFightDetails('1')?.estimatedValue, 0)
    assert.equal(service.getFightDetails('1')?.originalValue, 135_407_077)
    await service.setFightValuation('1', 'INVENTORY', prices)
    assert.equal(service.getTodayStats().lossValue, 500)
    assert.equal(service.getTodayStats().deaths, 1)
    await service.setFightValuation('1', 'FULL', prices)
    assert.equal(service.getTodayStats().lossValue, 135_407_077)
    assert.equal(service.getFightDetails('1')?.pricingTimestamp, 1234)
    db.insertEvent({ ...event, eventId: '2', rawJson: '{}' })
    await assert.rejects(service.setFightValuation('2', 'INVENTORY', prices), /Inventory data/)
    assert.deepEqual(db.getProfitTracking('a'), { mode: 'TODAY', startedAt: null })
    db.setProfitTracking('a', 'SESSION')
    const tracking = db.getProfitTracking('a')
    assert.equal(tracking.mode, 'SESSION')
    assert.ok(tracking.startedAt !== null)
    db.insertEvent({ ...event, eventId: 'session-kill', type: 'KILL', timestamp: tracking.startedAt!, estimatedValue: 1000 })
    db.insertEvent({ ...event, eventId: 'late-import', timestamp: tracking.startedAt! - 1, estimatedValue: 500 })
    assert.equal(service.getTrackingStats().profit, 1000)
    assert.equal(service.getTrackingStats().deaths, 0)
    const dashboard = service.getDashboard('ALL', { running: false, syncing: false, lastSyncAt: null, lastError: null, nextSyncAt: null })
    assert.equal(dashboard.trackingStats.profit, 1000)
    assert.equal(dashboard.trackingFights.length, 1)
    assert.equal(dashboard.recentFights.length, 4)
    db.close()
    db = new AppDatabase(path)
    service = new StatisticsService(db)
    assert.deepEqual(db.getProfitTracking('a'), tracking)
    assert.equal(service.getTrackingStats().profit, 1000)
    db.setProfitTracking('a', 'TODAY')
    assert.deepEqual(service.getTrackingStats(), service.getTodayStats())
    assert.equal(db.listEvents('a', 'ALL').length, 4)
    db.saveProfile({ id: 'other', name: 'Other', server: 'EUROPE' })
    assert.deepEqual(db.getProfitTracking('other'), { mode: 'TODAY', startedAt: null })
    assert.equal(service.getTrackingStats().profit, 0)
    db.saveProfile({ id: 'a', name: 'A', server: 'EUROPE' })
    db.insertEvent({ ...event, eventId: 'legacy', pricingMethod: 'MEDIAN_CITY_SELL_MIN' })
    assert.equal(db.listLegacyPricedEvents('a').length, 1)
    db.setEventValuation('a', 'legacy', 'INVENTORY', 400)
    db.updateEventPrices('a', 'legacy', 9000, 1200)
    assert.equal(db.getEvent('a', 'legacy')?.adjustedValue, 1200)
    assert.equal(db.getEvent('a', 'legacy')?.estimatedValue, 9000)
    assert.equal(db.listLegacyPricedEvents('a').length, 0)
    db.setEventValuation('a', 'legacy', 'NONE', 0)
    db.updateEventPrices('a', 'legacy', 11000, 1500)
    assert.equal(service.getFightDetails('legacy')?.estimatedValue, 0)
    db.saveCachedPrice('EUROPE', 'T4_BAG', 1, 900)
    assert.equal(db.getCachedPrice('EUROPE', 'T4_BAG', 1, 60000), 900)
    db.saveProfile({ id: 'other', name: 'Other', server: 'EUROPE' })
    await assert.rejects(service.setFightValuation('1', 'NONE', prices), /Fight not found/)
    console.log('Database valuation integration passed: persistence, inventory-only pricing, restoration, profile isolation.')
  } finally {
    db.close()
    for (const suffix of ['', '-wal', '-shm']) {
      try { unlinkSync(path + suffix) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1 })
