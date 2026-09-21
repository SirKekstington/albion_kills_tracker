import { useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { DEFAULT_OVERLAY_CSS, DEFAULT_OVERLAY_HTML, renderOverlay } from '../../shared/overlay'

export function OverlayEditor({ settings, onChange }: { settings: AppSettings; onChange: (settings: AppSettings) => void }) {
  const [preview, setPreview] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setPreview(renderOverlay(settings, {
      profit: '+20.6m', loss: '8.4m', profit_raw: '20600000', loss_raw: '8400000'
    })), 250)
    return () => clearTimeout(timer)
  }, [settings.overlayHtml, settings.overlayCss, settings.overlayCustomEnabled, settings.overlayTransparent])
  return <div className="overlay-editor">
    <label className="overlay-check"><input type="checkbox" checked={settings.overlayTransparent} onChange={(event) => onChange({ ...settings, overlayTransparent: event.target.checked })} /> No background (transparent)</label>
    <label className="overlay-check"><input type="checkbox" checked={settings.overlayCustomEnabled} onChange={(event) => onChange({ ...settings, overlayCustomEnabled: event.target.checked })} /> Use custom HTML + CSS</label>
    {settings.overlayCustomEnabled && <>
      <p className="detail-note">Insert <code>{'{{profit}}'}</code> and <code>{'{{loss}}'}</code> in your HTML text. For full numbers use <code>{'{{profit_raw}}'}</code> and <code>{'{{loss_raw}}'}</code>. Values use today’s statistics and update every 3 seconds. HTML + CSS only; no JavaScript needed.</p>
      <div className="overlay-code-fields">
        <label>HTML<textarea spellCheck={false} maxLength={100000} value={settings.overlayHtml} onChange={(event) => onChange({ ...settings, overlayHtml: event.target.value })} /></label>
        <label>CSS<textarea spellCheck={false} maxLength={100000} value={settings.overlayCss} onChange={(event) => onChange({ ...settings, overlayCss: event.target.value })} /></label>
      </div>
      {!/\{\{(profit|loss|profit_raw|loss_raw)\}\}/.test(settings.overlayHtml) && <p className="detail-note">No value placeholders found. Add a placeholder to display live statistics.</p>}
      <button type="button" className="text-button" onClick={() => onChange({ ...settings, overlayHtml: DEFAULT_OVERLAY_HTML, overlayCss: DEFAULT_OVERLAY_CSS })}>Reset HTML / CSS to example</button>
    </>}
    <p className="detail-note">Preview with sample values · Save settings to apply in OBS. {settings.overlayTransparent && 'Backgrounds, borders and panel shadows are disabled, including in custom CSS.'}</p>
    <div className="overlay-preview-stage"><iframe title="OBS overlay preview with sample values" sandbox="" referrerPolicy="no-referrer" srcDoc={preview} /></div>
  </div>
}
