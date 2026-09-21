import { t, useLanguage } from './i18n'
import { useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { DEFAULT_OVERLAY_CSS, DEFAULT_OVERLAY_HTML, overlayValues, renderOverlay } from '../../shared/overlay'
import { EMPTY_STATS } from '../../shared/types'

export function OverlayEditor({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const language = useLanguage()
  const [preview, setPreview] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setPreview(renderOverlay({ ...settings, language },
      overlayValues({ ...EMPTY_STATS, profit: 20600000, lossValue: 8400000 }, language))), 250)
    return () => clearTimeout(timer)
  }, [settings.overlayHtml, settings.overlayCss, settings.overlayCustomEnabled, settings.overlayTransparent, language])
  return <div className="overlay-editor">
    <label className="overlay-check"><input type="checkbox" checked={settings.overlayTransparent} onChange={(event) => onChange({ ...settings, overlayTransparent: event.target.checked })} /> {t("No background (transparent)")}</label>
    <label className="overlay-check"><input type="checkbox" checked={settings.overlayCustomEnabled} onChange={(event) => onChange({ ...settings, overlayCustomEnabled: event.target.checked })} /> {t("Use custom HTML + CSS")}</label>
    {settings.overlayCustomEnabled && <>
      <p className="detail-note">{t('Insert {{profit}} and {{loss}} in your HTML text. For full numbers use {{profit_raw}} and {{loss_raw}}. Values use the dashboard’s tracking period (whole day or current session) and update every 3 seconds. HTML + CSS only; no JavaScript needed.')}</p>
      <div className="overlay-code-fields">
        <label>HTML<textarea spellCheck={false} maxLength={100000} value={settings.overlayHtml} onChange={(event) => onChange({ ...settings, overlayHtml: event.target.value })} /></label>
        <label>CSS<textarea spellCheck={false} maxLength={100000} value={settings.overlayCss} onChange={(event) => onChange({ ...settings, overlayCss: event.target.value })} /></label>
      </div>
      {!/\{\{(profit|loss|profit_raw|loss_raw)\}\}/.test(settings.overlayHtml) && <p className="detail-note">{t("No value placeholders found. Add a placeholder to display live statistics.")}</p>}
      <button type="button" className="text-button" onClick={() => onChange({ ...settings, overlayHtml: DEFAULT_OVERLAY_HTML, overlayCss: DEFAULT_OVERLAY_CSS })}>{t("Reset HTML / CSS to example")}</button>
    </>}
    <p className="detail-note">{t("Preview with sample values · Save settings to apply in OBS.")} {settings.overlayTransparent && t("Backgrounds, borders and panel shadows are disabled, including in custom CSS.")}</p>
    <div className="overlay-preview-stage"><iframe title={t("OBS overlay preview with sample values")} sandbox="" referrerPolicy="no-referrer" srcDoc={preview} /></div>
  </div>
}
