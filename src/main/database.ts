import Database from 'better-sqlite3'
import { DEFAULT_OVERLAY_APPEARANCE } from '../shared/overlay'
import type {
  AppSettings,
  EventType,
  PlayerProfile,
  ProfitTracking,
  StoredEvent,
  TimeRange,
  ValuationMode
} from '../shared/types'

interface EventRow {
  valuation_mode?: ValuationMode
  adjusted_value?: number
  valuation_timestamp?: number
  event_id: string
  profile_id: string
  event_timestamp: number
  event_type: EventType
  killer_name: string
  victim_name: string
  kill_fame: number
  estimated_value: number
  pricing_timestamp: number
  raw_json: string
}

export class AppDatabase {
  private readonly db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        guild_name TEXT,
        server TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        profile_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        event_timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        killer_name TEXT NOT NULL,
        victim_name TEXT NOT NULL,
        kill_fame INTEGER NOT NULL DEFAULT 0,
        estimated_value INTEGER NOT NULL DEFAULT 0,
        pricing_timestamp INTEGER NOT NULL,
        pricing_method TEXT NOT NULL DEFAULT 'MEDIAN_CITY_SELL_MIN',
        raw_json TEXT NOT NULL,
        PRIMARY KEY (profile_id, event_id),
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_profile_time
        ON events(profile_id, event_timestamp DESC);

      CREATE TABLE IF NOT EXISTS event_valuations (
        profile_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        valuation_mode TEXT NOT NULL,
        adjusted_value INTEGER NOT NULL,
        valuation_timestamp INTEGER NOT NULL,
        PRIMARY KEY (profile_id, event_id),
        FOREIGN KEY (profile_id, event_id) REFERENCES events(profile_id, event_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS item_prices (
        server TEXT NOT NULL,
        item_id TEXT NOT NULL,
        quality INTEGER NOT NULL,
        median_sell_price INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (server, item_id, quality)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profit_tracking (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        started_at INTEGER
      );
    `)
  }

  getActiveProfile(): PlayerProfile | null {
    const row = this.db
      .prepare('SELECT id, name, guild_name, server FROM profiles WHERE active = 1 LIMIT 1')
      .get() as { id: string; name: string; guild_name: string | null; server: PlayerProfile['server'] } | undefined

    return row
      ? { id: row.id, name: row.name, guildName: row.guild_name ?? undefined, server: row.server }
      : null
  }

  saveProfile(profile: PlayerProfile): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE profiles SET active = 0').run()
      this.db.prepare(`
        INSERT INTO profiles (id, name, guild_name, server, active, created_at)
        VALUES (@id, @name, @guildName, @server, 1, @createdAt)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          guild_name = excluded.guild_name,
          server = excluded.server,
          active = 1
      `).run({ ...profile, guildName: profile.guildName ?? null, createdAt: Date.now() })
    })
    transaction()
  }

  insertEvent(event: StoredEvent): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        profile_id, event_id, event_timestamp, event_type, killer_name,
        victim_name, kill_fame, estimated_value, pricing_timestamp, raw_json
      ) VALUES (
        @profileId, @eventId, @timestamp, @type, @killerName,
        @victimName, @killFame, @estimatedValue, @pricingTimestamp, @rawJson
      )
    `).run(event)
    return result.changes > 0
  }

  getEvent(profileId: string, eventId: string): StoredEvent | null {
    const row = this.db.prepare(`SELECT e.*, v.valuation_mode, v.adjusted_value, v.valuation_timestamp
      FROM events e LEFT JOIN event_valuations v USING (profile_id, event_id)
      WHERE e.profile_id = ? AND e.event_id = ?`)
      .get(profileId, eventId) as EventRow | undefined
    return row ? mapEventRow(row) : null
  }

  setEventValuation(profileId: string, eventId: string, mode: ValuationMode, value: number): void {
    if (mode === 'FULL') {
      this.db.prepare('DELETE FROM event_valuations WHERE profile_id = ? AND event_id = ?').run(profileId, eventId)
      return
    }
    this.db.prepare(`INSERT INTO event_valuations (profile_id, event_id, valuation_mode, adjusted_value, valuation_timestamp)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(profile_id, event_id) DO UPDATE SET
      valuation_mode = excluded.valuation_mode, adjusted_value = excluded.adjusted_value,
      valuation_timestamp = excluded.valuation_timestamp`).run(profileId, eventId, mode, value, Date.now())
  }

  hasEvent(profileId: string, eventId: string): boolean {
    return Boolean(
      this.db.prepare('SELECT 1 FROM events WHERE profile_id = ? AND event_id = ?')
        .get(profileId, eventId)
    )
  }

  getProfitTracking(profileId: string): ProfitTracking {
    const row = this.db.prepare('SELECT mode, started_at AS startedAt FROM profit_tracking WHERE profile_id = ?')
      .get(profileId) as ProfitTracking | undefined
    return row ?? { mode: 'TODAY', startedAt: null }
  }

  setProfitTracking(profileId: string, mode: ProfitTracking['mode']): void {
    this.db.prepare(`INSERT INTO profit_tracking (profile_id, mode, started_at) VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET mode = excluded.mode, started_at = excluded.started_at`)
      .run(profileId, mode, mode === 'SESSION' ? Date.now() : null)
  }

  listEvents(profileId: string, range: TimeRange, limit?: number, since?: number): StoredEvent[] {
    const start = since ?? getRangeStart(range)
    const conditions = ['e.profile_id = @profileId']
    if (start !== null) conditions.push('event_timestamp >= @start')
    const limitClause = limit ? 'LIMIT @limit' : ''

    const rows = this.db.prepare(`
      SELECT e.*, v.valuation_mode, v.adjusted_value, v.valuation_timestamp FROM events e
      LEFT JOIN event_valuations v USING (profile_id, event_id)
      WHERE ${conditions.join(' AND ')}
      ORDER BY event_timestamp DESC
      ${limitClause}
    `).all({ profileId, start: start ?? 0, limit: limit ?? -1 }) as EventRow[]

    return rows.map(mapEventRow)
  }

  getCachedPrice(server: string, itemId: string, quality: number, maxAgeMs: number): number | null {
    const row = this.db.prepare(`
      SELECT median_sell_price AS price, fetched_at AS fetchedAt
      FROM item_prices
      WHERE server = ? AND item_id = ? AND quality = ?
    `).get(server, itemId, quality) as { price: number; fetchedAt: number } | undefined

    if (!row || Date.now() - row.fetchedAt > maxAgeMs) return null
    return row.price
  }

  saveCachedPrice(server: string, itemId: string, quality: number, price: number): void {
    this.db.prepare(`
      INSERT INTO item_prices (server, item_id, quality, median_sell_price, fetched_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(server, item_id, quality) DO UPDATE SET
        median_sell_price = excluded.median_sell_price,
        fetched_at = excluded.fetched_at
    `).run(server, itemId, quality, price, Date.now())
  }

  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    const values = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]))
    return {
      language: values.language === 'de' ? 'de' : 'en',
      overlayTransparent: typeof values.overlayTransparent === 'boolean' ? values.overlayTransparent : DEFAULT_OVERLAY_APPEARANCE.overlayTransparent,
      overlayCustomEnabled: typeof values.overlayCustomEnabled === 'boolean' ? values.overlayCustomEnabled : DEFAULT_OVERLAY_APPEARANCE.overlayCustomEnabled,
      overlayHtml: typeof values.overlayHtml === 'string' ? values.overlayHtml : DEFAULT_OVERLAY_APPEARANCE.overlayHtml,
      overlayCss: typeof values.overlayCss === 'string' ? values.overlayCss : DEFAULT_OVERLAY_APPEARANCE.overlayCss,
      refreshSeconds: typeof values.refreshSeconds === 'number' ? values.refreshSeconds : 20,
      overlayEnabled: typeof values.overlayEnabled === 'boolean' ? values.overlayEnabled : true,
      overlayPort: typeof values.overlayPort === 'number' ? values.overlayPort : 3847,
      launchAtStartup: typeof values.launchAtStartup === 'boolean' ? values.launchAtStartup : false
    }
  }

  saveSettings(settings: AppSettings): void {
    const statement = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    const transaction = this.db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) statement.run(key, JSON.stringify(value))
    })
    transaction()
  }

  setLanguage(language: 'en' | 'de'): void {
    this.db.prepare(`INSERT INTO settings (key, value) VALUES ('language', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(language))
  }

  close(): void {
    this.db.close()
  }
}

export function getRangeStart(range: TimeRange, now = new Date()): number | null {
  if (range === 'ALL') return null
  if (range === 'TODAY') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  const days = range === '7D' ? 7 : 30
  const start = new Date(now)
  start.setDate(start.getDate() - days)
  return start.getTime()
}

function mapEventRow(row: EventRow): StoredEvent {
  return {
    valuationMode: row.valuation_mode ?? 'FULL',
    adjustedValue: row.adjusted_value ?? undefined,
    valuationTimestamp: row.valuation_timestamp ?? undefined,
    eventId: row.event_id,
    profileId: row.profile_id,
    timestamp: row.event_timestamp,
    type: row.event_type,
    killerName: row.killer_name,
    victimName: row.victim_name,
    killFame: row.kill_fame,
    estimatedValue: row.estimated_value,
    pricingTimestamp: row.pricing_timestamp,
    rawJson: row.raw_json
  }
}
