import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { UpdateState } from '../../shared/types'
import { t } from './i18n'

const messages: Record<UpdateState['status'], string> = {
  disabled: 'Updates are available in the installed Windows app.',
  idle: 'Check GitHub for a newer version.',
  checking: 'Checking for updates…',
  current: 'You are up to date.',
  available: 'An update is available.',
  downloading: 'Downloading update…',
  downloaded: 'Update ready to install.',
  installing: 'Restarting to install update…',
  error: 'Update failed. Check your connection and try again.'
}

export function UpdateSettings(): ReactElement {
  const [state, setState] = useState<UpdateState | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.tracker.getUpdateState().then((result) => {
        if (active) { setState(result); setFailed(false) }
      }).catch(() => { if (active) setFailed(true) })
    }
    const unsubscribe = window.tracker.onUpdated(refresh)
    refresh()
    return () => { active = false; unsubscribe() }
  }, [])
  const act = async (install: boolean): Promise<void> => {
    setFailed(false)
    try { setState(await (install ? window.tracker.installUpdate() : window.tracker.checkForUpdates())) }
    catch { setFailed(true) }
  }
  const busy = !state || ['checking', 'downloading', 'installing', 'disabled'].includes(state.status)
  return <section className="content-card settings-card update-settings">
    <div className="settings-title"><div><h3>{t('App updates')}</h3><p>{t('One prompt per new version. You can update here at any time.')}</p></div></div>
    {state && <p>{t('Installed version: {version}', { version: state.currentVersion })}{state.version && <> · {t('Available version: {version}', { version: state.version })}</>}</p>}
    <p role="status" aria-live="polite">{failed ? t('Update failed. Check your connection and try again.') : state ? t(messages[state.status]) : t('Checking for updates…')}</p>
    {state?.status === 'downloading' && <progress aria-label={t('Downloading update…')} value={state.progress} max={100} />}
    <div className="update-actions">
      <button className="secondary-button" disabled={busy || state?.status === 'downloaded'} onClick={() => void act(false)}>{t('Check for updates')}</button>
      {state?.version && <button className="primary-button" disabled={busy} onClick={() => void act(true)}>{t('Update and restart')}</button>}
    </div>
    <p className="detail-note">{t('The update will download and restart the app. You can also update later in Settings.')}</p>
  </section>
}
