import type { DashboardStats } from './types'

export const DEFAULT_OVERLAY_HTML = `<div class="overlay">
  <div>Profit: <span class="profit">{{profit}}</span></div>
  <div>Loss: <span class="loss">{{loss}}</span></div>
</div>`
export const DEFAULT_OVERLAY_CSS = `.overlay { display: inline-flex; flex-direction: column; gap: 6px; padding: 12px; font: 700 28px "Segoe UI", sans-serif; color: white; }
.profit { color: #70e1a1; }
.loss { color: #ff7d88; }`

export interface OverlayAppearance {
  overlayTransparent: boolean
  overlayCustomEnabled: boolean
  overlayHtml: string
  overlayCss: string
}

export const DEFAULT_OVERLAY_APPEARANCE: OverlayAppearance = {
  overlayTransparent: false,
  overlayCustomEnabled: false,
  overlayHtml: DEFAULT_OVERLAY_HTML,
  overlayCss: DEFAULT_OVERLAY_CSS
}

export function overlayValues(stats: DashboardStats): Record<string, string> {
  const format = (value: number, signed = false): string => {
    const absolute = Math.abs(value)
    const sign = value < 0 ? '−' : signed ? '+' : ''
    return sign + (absolute >= 1e9 ? (absolute / 1e9).toFixed(2) + 'b'
      : absolute >= 1e6 ? (absolute / 1e6).toFixed(1) + 'm'
        : absolute >= 1e3 ? Math.round(absolute / 1e3) + 'k' : String(absolute))
  }
  return { profit: format(stats.profit, true), loss: format(stats.lossValue), profit_raw: String(stats.profit), loss_raw: String(stats.lossValue) }
}

// Shared by the OBS page and the sandboxed, script-free editor preview.
export function renderOverlay(appearance: OverlayAppearance, values: Record<string, string>, script = ''): string {
  const html = appearance.overlayCustomEnabled ? appearance.overlayHtml : DEFAULT_OVERLAY_HTML
  const css = appearance.overlayCustomEnabled ? appearance.overlayCss : `${DEFAULT_OVERLAY_CSS}
.overlay { padding:12px 16px; border-radius:12px; background:rgba(10,13,20,.82); border:1px solid rgba(255,255,255,.10); text-shadow:0 2px 10px #000; backdrop-filter:blur(8px); }`
  const content = html.replace(/\{\{(profit|loss|profit_raw|loss_raw)\}\}/g, (_, key: string) =>
    `<span data-overlay-value="${key}">${values[key] ?? '—'}</span>`)
  const styles = `<style>html,body{margin:0;background:transparent;overflow:hidden;}\n${css.replace(/<\/style/gi, '<\\/style')}
${appearance.overlayTransparent ? 'html,body,body *{background:transparent!important;background-image:none!important;box-shadow:none!important;backdrop-filter:none!important;border-color:transparent!important;}' : ''}</style>`
  if (/<html[\s>]/i.test(content)) {
    const withStyles = /<\/head>/i.test(content) ? content.replace(/<\/head>/i, () => `${styles}</head>`) : content.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${styles}</head>`)
    return /<\/body>/i.test(withStyles) ? withStyles.replace(/<\/body>/i, () => `${script}</body>`) : withStyles + script
  }
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width">${styles}</head><body>${content}${script}</body></html>`
}
