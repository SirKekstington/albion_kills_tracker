export type AlbionServer = 'EUROPE' | 'AMERICAS' | 'ASIA'
export type EventType = 'KILL' | 'ASSIST' | 'DEATH'
export type TimeRange = 'TODAY' | '7D' | '30D' | 'ALL'
export type ValuationMode = 'FULL' | 'INVENTORY' | 'NONE'

export interface ServerDefinition {
  key: AlbionServer
  label: string
  gameInfoBaseUrl: string
  priceBaseUrl: string
}

export interface PlayerProfile {
  id: string
  name: string
  guildName?: string
  server: AlbionServer
}

export interface PlayerSearchResult extends PlayerProfile {
  allianceName?: string
}

export interface AlbionItem {
  Type?: string | null
  Count?: number
  Quality?: number
}

export interface AlbionPlayer {
  Id?: string
  Name?: string
  GuildName?: string
  AllianceName?: string
  AverageItemPower?: number
  Equipment?: Record<string, AlbionItem | null>
  Inventory?: Array<AlbionItem | null>
}

export interface AlbionEvent {
  EventId: number | string
  TimeStamp: string
  Killer?: AlbionPlayer
  Victim?: AlbionPlayer
  Participants?: AlbionPlayer[]
  TotalVictimKillFame?: number
}

export interface StoredEvent {
  valuationMode?: ValuationMode
  adjustedValue?: number
  valuationTimestamp?: number
  eventId: string
  profileId: string
  timestamp: number
  type: EventType
  killerName: string
  victimName: string
  killFame: number
  estimatedValue: number
  pricingTimestamp: number
  rawJson: string
}

export interface DashboardStats {
  kills: number
  assists: number
  deaths: number
  killValue: number
  assistValue: number
  lossValue: number
  profit: number
}

export interface FightSummary {
  playerWeapon: AlbionItem | null
  opponentWeapon: AlbionItem | null
  valuationMode: ValuationMode
  eventId: string
  timestamp: number
  type: EventType
  opponentName: string
  estimatedValue: number
  killFame: number
}

export interface DashboardData {
  profile: PlayerProfile | null
  range: TimeRange
  stats: DashboardStats
  recentFights: FightSummary[]
  collector: CollectorStatus
}

export interface FightDetails extends FightSummary {
  originalValue: number
  pricingTimestamp: number
  player: AlbionPlayer | null
  opponent: AlbionPlayer | null
  killer: AlbionPlayer | null
  victim: AlbionPlayer | null
  assists: AlbionPlayer[]
}

export interface CollectorStatus {
  running: boolean
  syncing: boolean
  lastSyncAt: number | null
  lastError: string | null
  nextSyncAt: number | null
}

export interface AppSettings {
  overlayTransparent: boolean
  overlayCustomEnabled: boolean
  overlayHtml: string
  overlayCss: string
  refreshSeconds: number
  overlayEnabled: boolean
  overlayPort: number
  launchAtStartup: boolean
}

export interface SaveProfileInput {
  id: string
  name: string
  guildName?: string
  server: AlbionServer
}

export interface AppApi {
  searchPlayers(server: AlbionServer, query: string): Promise<PlayerSearchResult[]>
  saveProfile(input: SaveProfileInput): Promise<void>
  getProfile(): Promise<PlayerProfile | null>
  getDashboard(range: TimeRange): Promise<DashboardData>
  getFightDetails(eventId: string): Promise<FightDetails | null>
  setFightValuation(eventId: string, mode: ValuationMode): Promise<FightDetails>
  getItemImage(itemId: string, quality: number): Promise<string>
  refreshNow(): Promise<CollectorStatus>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  getOverlayUrl(): Promise<string>
  openExternal(url: string): Promise<void>
}

export const EMPTY_STATS: DashboardStats = {
  kills: 0,
  assists: 0,
  deaths: 0,
  killValue: 0,
  assistValue: 0,
  lossValue: 0,
  profit: 0
}
