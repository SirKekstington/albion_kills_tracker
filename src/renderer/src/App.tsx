import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Activity,
  BarChart3,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clipboard,
  Crosshair,
  Github,
  LoaderCircle,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Skull,
  Swords,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff
} from 'lucide-react'
import type {
  AlbionServer,
  AppSettings,
  DashboardData,
  FightSummary,
  PlayerProfile,
  PlayerSearchResult,
  TimeRange
} from '../../shared/types'
import { EMPTY_STATS } from '../../shared/types'
import { FightDetailsDialog } from './FightDetailsDialog'
import { OverlayEditor } from './OverlayEditor'
import { FightWeapon } from './FightWeapon'
import { t, locale, useLanguage, applyLanguage, LanguageSelect } from './i18n'

type View = 'dashboard' | 'fights' | 'statistics' | 'settings'

const RANGES: Array<{ key: TimeRange; label: string }> = [
  { key: 'TODAY', label: 'Today' },
  { key: '7D', label: '7 days' },
  { key: '30D', label: '30 days' },
  { key: 'ALL', label: 'All time' }
]

const EMPTY_DASHBOARD: DashboardData = {
  tracking: { mode: 'TODAY', startedAt: null },
  trackingStats: { ...EMPTY_STATS },
  trackingFights: [],
  profile: null,
  range: 'TODAY',
  stats: { ...EMPTY_STATS },
  recentFights: [],
  collector: { running: false, syncing: false, lastSyncAt: null, lastError: null, nextSyncAt: null }
}

export function App(): ReactElement {
  useLanguage()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void window.tracker.getSettings().then((settings) => applyLanguage(settings.language)).catch(() => applyLanguage('en')).finally(() => setReady(true))
  }, [])
  return ready ? <TrackerApp /> : <Splash />
}

function TrackerApp(): ReactElement {
  const [profile, setProfile] = useState<PlayerProfile | null | undefined>(undefined)
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD)
  const [range, setRange] = useState<TimeRange>('TODAY')
  const [view, setView] = useState<View>('dashboard')
  const [loading, setLoading] = useState(false)

  const loadDashboard = useCallback(async (selectedRange = range) => {
    const data = await window.tracker.getDashboard(selectedRange)
    setDashboard(data)
    setProfile(data.profile)
  }, [range])

  useEffect(() => {
    void window.tracker.getProfile().then((result) => {
      setProfile(result)
      if (result) void loadDashboard()
    })
  }, [loadDashboard])

  useEffect(() => window.tracker.onUpdated(() => void loadDashboard()), [loadDashboard])

  useEffect(() => {
    if (profile) void loadDashboard(range)
  }, [range]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      await window.tracker.refreshNow()
      await loadDashboard()
    } finally {
      setLoading(false)
    }
  }

  if (profile === undefined) return <Splash />
  if (!profile) {
    return <Onboarding onComplete={(newProfile) => {
      setProfile(newProfile)
      void loadDashboard()
    }} />
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} onView={setView} profile={profile} />
      <main className="main-content">
        <Header
          profile={profile}
          collector={dashboard.collector}
          refreshing={loading}
          onRefresh={() => void refresh()}
        />
        {view === 'dashboard' && (
          <Dashboard
            data={dashboard}
            onTrackingChanged={() => void loadDashboard()}
            onShowFights={() => setView('fights')}
          />
        )}
        {view === 'fights' && <FightsView data={dashboard} range={range} onRange={setRange} />}
        {view === 'statistics' && <StatisticsView data={dashboard} range={range} onRange={setRange} />}
        {view === 'settings' && <SettingsView onProfileChanged={(p) => {
          setProfile(p)
          setView('dashboard')
          void loadDashboard()
        }} />}
        <RepositoryFooter />
      </main>
    </div>
  )
}

function Splash(): ReactElement {
  return <div className="splash"><div className="brand-mark"><Crosshair /></div><LoaderCircle className="spin" /></div>
}

function RepositoryFooter(): ReactElement {
  const url = 'https://github.com/SirKekstington/albion_kills_tracker'
  return <footer className="repository-footer"><a href={url} onClick={(event) => {
    event.preventDefault()
    void window.tracker.openExternal(url)
  }}><Github size={15} aria-hidden="true" /> {t("Albion PvP Tracker on GitHub")}</a></footer>
}

function Sidebar({ view, onView, profile }: { view: View; onView: (v: View) => void; profile: PlayerProfile }): ReactElement {
  const items: Array<{ key: View; label: string; icon: ReactElement }> = [
    { key: 'dashboard', label: t("Dashboard"), icon: <Activity size={19} /> },
    { key: 'fights', label: t("Fights"), icon: <Swords size={19} /> },
    { key: 'statistics', label: t("Statistics"), icon: <BarChart3 size={19} /> },
    { key: 'settings', label: t("Settings"), icon: <Settings size={19} /> }
  ]
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Crosshair /></div><div><b>ALBION</b><span>PvP Tracker</span></div></div>
    <nav>{items.map((item) => <button key={item.key} className={view === item.key ? 'active' : ''} onClick={() => onView(item.key)}>{item.icon}<span>{item.label}</span></button>)}</nav>
    <div className="sidebar-profile">
      <div className="avatar">{profile.name.slice(0, 2).toUpperCase()}</div>
      <div><b>{profile.name}</b><span>{serverLabel(profile.server)}</span></div>
    </div>
  </aside>
}

function Header({ profile, collector, refreshing, onRefresh }: {
  profile: PlayerProfile
  collector: DashboardData['collector']
  refreshing: boolean
  onRefresh: () => void
}): ReactElement {
  return <header className="topbar">
    <div><p className="eyebrow">{t("WELCOME BACK")}</p><h1>{profile.name}</h1></div>
    <div className="header-actions">
      <LanguageSelect />
      <div className={`status-pill ${collector.lastError ? 'error' : ''}`}>
        {collector.lastError ? <WifiOff size={15} /> : <Wifi size={15} />}
        <span>{collector.lastError ? t("Sync issue") : collector.syncing ? t("Syncing…") : t("Collector online")}</span>
      </div>
      <button className="icon-button" title={t("Refresh now")} onClick={onRefresh} disabled={refreshing || collector.syncing}>
        <RefreshCw size={18} className={refreshing || collector.syncing ? 'spin' : ''} />
      </button>
    </div>
  </header>
}

function RangeTabs({ value, onChange }: { value: TimeRange; onChange: (r: TimeRange) => void }): ReactElement {
  return <div className="range-tabs">{RANGES.map((r) => <button key={r.key} className={value === r.key ? 'active' : ''} onClick={() => onChange(r.key)}>{t(r.label)}</button>)}</div>
}

function Dashboard({ data, onTrackingChanged, onShowFights }: {
  data: DashboardData
  onTrackingChanged: () => void
  onShowFights: () => void
}): ReactElement {
  const stats = data.trackingStats
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [trackingError, setTrackingError] = useState('')
  const changeTracking = async (mode: 'TODAY' | 'SESSION'): Promise<void> => {
    setTrackingBusy(true); setTrackingError('')
    try { await window.tracker.setProfitTracking(mode); onTrackingChanged() }
    catch { setTrackingError('Could not save tracking period.') }
    finally { setTrackingBusy(false) }
  }
  return <div className="page">
    <section className="page-heading"><div><h2>{t("Your PvP overview")}</h2><p>{t('Profit and loss · same period as the OBS overlay')}</p></div></section>
    <section className="profit-tracking">
      <div><b>{data.tracking.mode === 'SESSION' ? t('Session active') : t('Whole day')}</b><p>{data.tracking.mode === 'SESSION' && data.tracking.startedAt !== null ? t('Since {date}', { date: new Date(data.tracking.startedAt).toLocaleString(locale()) }) : t('From today at 00:00 (local time)')}</p></div>
      <div className="tracking-actions"><button className={`secondary-button ${data.tracking.mode === 'TODAY' ? 'selected' : ''}`} disabled={trackingBusy || data.tracking.mode === 'TODAY'} onClick={() => void changeTracking('TODAY')}>{t('Whole day')}</button><button className="primary-button" disabled={trackingBusy} onClick={() => void changeTracking('SESSION')}>{data.tracking.mode === 'SESSION' ? t('New session from now') : t('Track from now')}</button></div>
    </section>
    {trackingError && <p className="alert" role="alert">{t(trackingError)}</p>}
    {data.collector.lastError && <div className="alert"><ShieldAlert size={18} /><span>{t('Sync failed. Please try refreshing again.')} {t("Existing statistics remain available.")}</span></div>}
    <section className="stats-grid">
      <StatCard tone="profit" icon={<CircleDollarSign />} label={t("Net profit")} value={formatSilver(stats.profit, true)} note={t("Kill value − loss")} />
      <StatCard tone="loss" icon={<Skull />} label={t("Loss")} value={formatSilver(stats.lossValue)} note={t(stats.deaths === 1 ? '{count} death' : '{count} deaths', { count: stats.deaths })} />
      <StatCard tone="kill" icon={<Swords />} label={t("Kill value")} value={`${formatSilver(stats.killValue)} (${formatSilver(stats.assistValue)})`} note={t("Assist value in brackets")} />
      <StatCard tone="neutral" icon={<Crosshair />} label={t("Fights")} value={`${stats.kills} / ${stats.deaths} / ${stats.assists}`} note={t("Kills · Deaths · Assists")} />
    </section>
    <section className="content-card recent-card">
      <div className="section-header"><div><p className="eyebrow">{t("LIVE FEED")}</p><h3>{t("Recent fights")}</h3></div><button className="text-button" onClick={onShowFights}>{t("View all")} <ChevronRight size={16} /></button></div>
      <FightList fights={data.trackingFights.slice(0, 8)} />
    </section>
    <section className="two-column">
      <div className="content-card mini-insight"><div className="insight-icon"><Radio /></div><div><p className="eyebrow">{t("OBS OVERLAY")}</p><h3>{t("Ready for your stream")}</h3><p>{t("Profit and loss update automatically while the app is running.")}</p></div></div>
      <div className="content-card mini-insight"><div className="insight-icon purple"><CircleDollarSign /></div><div><p className="eyebrow">{t("PRICING")}</p><h3>{t("Stable median values")}</h3><p>{t("Median of current city sell prices, saved with every fight.")}</p></div></div>
    </section>
  </div>
}

function StatCard({ icon, label, value, note, tone }: { icon: ReactElement; label: string; value: string; note: string; tone: string }): ReactElement {
  return <article className={`stat-card ${tone}`}><div className="stat-icon">{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></article>
}

function FightList({ fights }: { fights: FightSummary[] }): ReactElement {
  const [selected, setSelected] = useState<FightSummary | null>(null)
  if (!fights.length) return <div className="empty-state"><Swords size={30} /><h4>{t("No fights collected yet")}</h4><p>{t("Leave the tracker running. Recent kills and deaths are imported automatically.")}</p></div>
  return <><div className="fight-list">{fights.map((fight) => <button type="button" className="fight-row" key={fight.eventId} onClick={() => setSelected(fight)} aria-label={t('View {type} against {name}', {type: t(fight.type), name: fight.opponentName})} aria-haspopup="dialog">
    <div className={`fight-type ${fight.type.toLowerCase()}`}>{fight.type === 'KILL' ? <Swords /> : fight.type === 'ASSIST' ? <UsersRound /> : <Skull />}</div>
    <div className="fight-identity"><div className="fight-weapons"><FightWeapon item={fight.playerWeapon} label={t("Your weapon")} /><span className="weapon-versus" aria-hidden="true">/</span><FightWeapon item={fight.opponentWeapon} label={t('Weapon of {name}', {name: fight.opponentName})} /></div><div className="fight-main"><b>{t(fight.type)}{fight.valuationMode === 'NONE' ? t(" · NO LOSS") : fight.valuationMode === 'INVENTORY' ? t(" · INVENTORY ONLY") : ''}</b><span>{fight.opponentName}</span></div></div>
    <div className="fight-fame"><span>{t("Kill fame")}</span><b>{fight.killFame.toLocaleString(locale())}</b></div>
    <div className={`fight-value ${fight.type.toLowerCase()}`}>{fight.type === 'DEATH' ? '−' : fight.type === 'ASSIST' ? '(' : '+'}{formatSilver(fight.estimatedValue)}{fight.type === 'ASSIST' ? ')' : ''}</div>
    <time>{relativeTime(fight.timestamp)}</time>
  </button>)}</div>{selected && <FightDetailsDialog key={selected.eventId} fight={selected} onClose={() => setSelected(null)} />}</>
}

function FightsView({ data, range, onRange }: { data: DashboardData; range: TimeRange; onRange: (r: TimeRange) => void }): ReactElement {
  return <div className="page"><section className="page-heading"><div><h2>{t("Fight history")}</h2><p>{t("Your locally collected kills, assists and deaths.")}</p></div><RangeTabs value={range} onChange={onRange} /></section><section className="content-card"><FightList fights={data.recentFights} /></section></div>
}

function StatisticsView({ data, range, onRange }: { data: DashboardData; range: TimeRange; onRange: (r: TimeRange) => void }): ReactElement {
  const total = data.stats.kills + data.stats.assists + data.stats.deaths
  const survival = total ? Math.round(((data.stats.kills + data.stats.assists) / total) * 100) : 0
  return <div className="page"><section className="page-heading"><div><h2>{t("Statistics")}</h2><p>{t("A clean summary of your PvP performance.")}</p></div><RangeTabs value={range} onChange={onRange} /></section>
    <section className="stats-grid three"><StatCard tone="kill" icon={<Swords />} label={t("Kills")} value={String(data.stats.kills)} note={formatSilver(data.stats.killValue) + t(" total value")} /><StatCard tone="neutral" icon={<UsersRound />} label={t("Assists")} value={String(data.stats.assists)} note={formatSilver(data.stats.assistValue) + t(" fight value")} /><StatCard tone="profit" icon={<Activity />} label={t("Positive fights")} value={`${survival}%`} note={t("Kills + assists vs all fights")} /></section>
    <section className="content-card breakdown"><div className="section-header"><div><p className="eyebrow">{t("VALUE BREAKDOWN")}</p><h3>{t("Where your net value comes from")}</h3></div></div><ValueBar label={t("Direct kills")} value={data.stats.killValue} total={Math.max(data.stats.killValue, data.stats.lossValue)} tone="green" /><ValueBar label={t("Assisted fights")} value={data.stats.assistValue} total={Math.max(data.stats.assistValue, data.stats.killValue)} tone="yellow" /><ValueBar label={t("Losses")} value={data.stats.lossValue} total={Math.max(data.stats.killValue, data.stats.lossValue)} tone="red" /></section>
  </div>
}

function ValueBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }): ReactElement {
  const width = total ? Math.max(2, Math.min(100, value / total * 100)) : 0
  return <div className="value-bar"><div><span>{label}</span><b>{formatSilver(value)}</b></div><div className="bar-track"><span className={tone} style={{ width: `${width}%` }} /></div></div>
}

function SettingsView({ onProfileChanged }: { onProfileChanged: (p: PlayerProfile) => void }): ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [overlayUrl, setOverlayUrl] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  useEffect(() => { void Promise.all([window.tracker.getSettings(), window.tracker.getOverlayUrl()]).then(([s, url]) => { setSettings(s); setOverlayUrl(url) }) }, [])
  if (editingProfile) return <Onboarding compact onComplete={(p) => { setEditingProfile(false); onProfileChanged(p) }} />
  if (!settings) return <div className="page"><LoaderCircle className="spin" /></div>
  const save = async (): Promise<void> => {
    setSaving(true); setSaveError('')
    try {
      const result = await window.tracker.saveSettings(settings)
      setSettings(result)
      setOverlayUrl(await window.tracker.getOverlayUrl())
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch { setSaveError("Could not apply settings. Check the overlay port and try again.") }
    finally { setSaving(false) }
  }
  const copy = async (): Promise<void> => { await navigator.clipboard.writeText(overlayUrl); setSaved(true); setTimeout(() => setSaved(false), 1800) }
  return <div className="page settings-page"><section className="page-heading"><div><h2>{t("Settings")}</h2><p>{t("Collector, Windows startup and streaming integration.")}</p></div></section>
    <section className="content-card settings-card"><div className="settings-title"><div className="insight-icon"><Radio /></div><div><h3>{t("OBS browser source")}</h3><p>{t("Only available on this computer via 127.0.0.1.")}</p></div></div>
      <Toggle label={t("Enable overlay server")} checked={settings.overlayEnabled} onChange={(v) => setSettings({ ...settings, overlayEnabled: v })} />
      <div className="field-row"><label>{t("Port")}<input type="number" min="1024" max="65535" value={settings.overlayPort} onChange={(e) => setSettings({ ...settings, overlayPort: Number(e.target.value) })} /></label><label className="url-field">{t("OBS URL")}<div><input readOnly value={overlayUrl} /><button onClick={() => void copy()} title={t("Copy URL")}><Clipboard size={17} /></button></div></label></div>
      <OverlayEditor settings={settings} onChange={setSettings} />
    </section>
    <section className="content-card settings-card"><div className="settings-title"><div className="insight-icon purple"><Settings /></div><div><h3>{t("Collector")}</h3><p>{t("How frequently the public event endpoints are checked.")}</p></div></div><label>{t("Refresh interval")}<select value={settings.refreshSeconds} onChange={(e) => setSettings({ ...settings, refreshSeconds: Number(e.target.value) })}><option value="10">{t("10 seconds")}</option><option value="20">{t("20 seconds")}</option><option value="30">{t("30 seconds")}</option><option value="60">{t("60 seconds")}</option></select></label><Toggle label={t("Launch with Windows")} checked={settings.launchAtStartup} onChange={(v) => setSettings({ ...settings, launchAtStartup: v })} /></section>
    {saveError && <p role="alert" className="alert">{t(saveError)}</p>}
    <section className="settings-actions"><button className="secondary-button" onClick={() => setEditingProfile(true)}><UserRound size={17} /> {t("Change character")}</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saved ? <Check size={18} /> : null}{saving ? t("Saving…") : saved ? t("Saved") : t("Save settings")}</button></section>
  </div>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): ReactElement {
  return <label className="toggle-row"><span>{label}</span><button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button></label>
}

function Onboarding({ onComplete, compact = false }: { onComplete: (p: PlayerProfile) => void; compact?: boolean }): ReactElement {
  const [server, setServer] = useState<AlbionServer>('EUROPE')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlayerSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const search = async (): Promise<void> => {
    setSearching(true); setError(''); setResults([])
    try { setResults(await window.tracker.searchPlayers(server, query)) }
    catch { setError("Player search failed.") }
    finally { setSearching(false) }
  }
  const choose = async (player: PlayerSearchResult): Promise<void> => { try { await window.tracker.saveProfile(player); onComplete(player) } catch { setError('Could not select character.') } }
  return <div className={compact ? 'onboarding compact' : 'onboarding'}><div className="onboarding-panel">
    <LanguageSelect />
    <div className="brand large"><div className="brand-mark"><Crosshair /></div><div><b>ALBION</b><span>PvP Tracker</span></div></div>
    <div className="onboarding-copy"><p className="eyebrow">{t("LOCAL-FIRST PVP STATS")}</p><h1>{compact ? t("Change character") : t("Track every fight. Know your value.")}</h1><p>{t("Choose your Albion server and find your character. Your statistics stay on your PC.")}</p></div>
    <div className="server-picker">{(['EUROPE', 'AMERICAS', 'ASIA'] as AlbionServer[]).map((item) => <button key={item} className={server === item ? 'active' : ''} onClick={() => setServer(item)}>{serverLabel(item)}{server === item && <Check size={15} />}</button>)}</div>
    <form className="search-box" onSubmit={(e) => { e.preventDefault(); if (query.trim().length >= 2) void search() }}><Search size={20} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Enter character name")} /><button disabled={query.trim().length < 2 || searching}>{searching ? <LoaderCircle className="spin" size={18} /> : t("Find player")}</button></form>
    {error && <div className="alert"><ShieldAlert size={18} /><span>{t(error)}</span></div>}
    {results.length > 0 && <div className="search-results">{results.slice(0, 8).map((player) => <button key={player.id} onClick={() => void choose(player)}><div className="avatar">{player.name.slice(0, 2).toUpperCase()}</div><div><b>{player.name}</b><span>{player.guildName || t("No guild")}{player.allianceName ? ` · ${player.allianceName}` : ''}</span></div><ChevronRight /></button>)}</div>}
    {!compact && <p className="disclaimer">{t("Not affiliated with Sandbox Interactive. Market prices are provided by the Albion Online Data Project.")}</p>}
    {!compact && <RepositoryFooter />}
  </div></div>
}

function serverLabel(server: AlbionServer): string { return server === 'EUROPE' ? t("Europe") : server === 'AMERICAS' ? t("Americas") : t("Asia") }

function formatSilver(value: number, signed = false): string {
  const absolute = Math.abs(value)
  const sign = signed ? value >= 0 ? '+' : '−' : ''
  if (absolute >= 1_000_000_000) return `${sign}${(absolute / 1_000_000_000).toLocaleString(locale(), {minimumFractionDigits: 2, maximumFractionDigits: 2})}b`
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toLocaleString(locale(), {minimumFractionDigits: 1, maximumFractionDigits: 1})}m`
  if (absolute >= 1_000) return `${sign}${Math.round(absolute / 1_000)}k`
  return `${sign}${absolute.toLocaleString(locale())}`
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return t("just now")
  if (seconds < 3600) return new Intl.RelativeTimeFormat(locale(), {numeric: 'always'}).format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86400) return new Intl.RelativeTimeFormat(locale(), {numeric: 'always'}).format(-Math.floor(seconds / 3600), 'hour')
  return new Intl.RelativeTimeFormat(locale(), {numeric: 'always'}).format(-Math.floor(seconds / 86400), 'day')
}
