import { useEffect, useState } from 'react'
import type { DebugSnapshot } from '../../shared/types'
import { t, locale } from './i18n'

export default function DebugPanel() {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [eventId, setEventId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!open || !window.tracker.getDebugSnapshot) return
    let active = true
    const load = async () => {
      try { const data = await window.tracker.getDebugSnapshot!(); if (active) setSnapshot(data) }
      catch { if (active) setMessage('Diagnostics unavailable') }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => { active = false; clearInterval(timer) }
  }, [open])
  if (!window.tracker.getDebugSnapshot) return null
  return <details className="debug-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t('Developer diagnostics')} · DEV</summary>
    {open && <>
      <p>{t('Diagnostics explain imports, session inclusion and pending prices. Technical log messages are shown as recorded.')}</p>
      <p>{t('Latest 500 entries from this run. Copy diagnostics before restarting.')}</p>
      <div className="debug-actions"><label>{t('Event ID')}<input value={eventId} onChange={(event) => setEventId(event.target.value)} placeholder="437474461" /></label>
        <button className="secondary-button" disabled={busy || !/^\d{1,20}$/.test(eventId)} onClick={async () => {
          setBusy(true); setMessage('')
          try { const inserted = await window.tracker.debugImportEvent!(eventId); setMessage(inserted ? 'Event imported' : 'Event already stored') }
          catch (error) { setMessage(String(error)) }
          finally { setBusy(false) }
        }}>{t('Check and import event')}</button>
        <button className="secondary-button" disabled={!snapshot} onClick={async () => {
          try { await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2)); setMessage('Diagnostics copied') }
          catch { setMessage('Could not copy diagnostics') }
        }}>{t('Copy diagnostics')}</button>
      </div>
      {message && <p role="status">{t(message)}</p>}
      {snapshot && <>
        <pre>{JSON.stringify({ profile: snapshot.profile, tracking: snapshot.tracking, collector: snapshot.collector, pendingPrices: snapshot.pendingPrices, now: snapshot.now }, null, 2)}</pre>
        <h4>{t('Recent event decisions')}</h4>
        <div className="debug-scroll"><table><thead><tr><th>{t('Event ID')}</th><th>{t('Time')}</th><th>{t('Decision')}</th><th>{t('Pricing')}</th></tr></thead><tbody>{snapshot.events.map((event) => <tr key={event.eventId}><td>{event.eventId}</td><td>{new Date(event.timestamp).toLocaleString(locale())}</td><td>{event.type} · {event.reason}</td><td>{event.pricingMethod} · {event.value.toLocaleString(locale())}</td></tr>)}</tbody></table></div>
        <label className="debug-filter"><input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />{t('Warnings and errors only')}</label>
        <div className="debug-scroll">{snapshot.entries.filter((entry) => !errorsOnly || entry.level !== 'info').map((entry, index) => <pre className={`debug-${entry.level}`} key={`${entry.timestamp}-${index}`}>{new Date(entry.timestamp).toLocaleTimeString(locale())} [{entry.level}] {entry.scope}: {entry.message}{entry.data ? '\n' + JSON.stringify(entry.data, null, 2) : ''}</pre>)}</div>
      </>}
    </>}
  </details>
}
