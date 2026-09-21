import { useEffect, useState, useSyncExternalStore } from 'react'
import { translate, type Language } from '../../shared/translations'

let language: Language = 'en'
const listeners = new Set<() => void>()
export const locale = (): string => language === 'de' ? 'de-DE' : 'en-GB'
export const t = (key: string, values?: Record<string, string | number>): string => translate(language, key, values)
export function useLanguage(): Language {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => language)
}
export function applyLanguage(value: Language): void {
  language = value
  document.documentElement.lang = value
  listeners.forEach((listener) => listener())
}
export function LanguageSelect() {
  const value = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => { setError(false) }, [value])
  return <div className="language-control"><label>{t('Language')}<select value={value} disabled={busy} onChange={async (event) => {
    const next = event.target.value as Language
    setBusy(true); setError(false)
    try { await window.tracker.setLanguage(next); applyLanguage(next) }
    catch { setError(true) }
    finally { setBusy(false) }
  }}><option value="en">English</option><option value="de">Deutsch</option></select></label>{error && <span role="alert">{t('Could not save language.')}</span>}</div>
}
