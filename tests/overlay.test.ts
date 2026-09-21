import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { DEFAULT_OVERLAY_APPEARANCE, overlayValues, renderOverlay } from '../src/shared/overlay'
import { EMPTY_STATS } from '../src/shared/types'
import { OverlayServer } from '../src/main/overlay-server'
import type { StatisticsService } from '../src/main/statistics-service'

describe('overlay templates', () => {
  it('formats positive, negative and raw values without losing the sign', () => {
    expect(overlayValues({ ...EMPTY_STATS, profit: -20_600_000, lossValue: 8_400_000 })).toEqual({
      profit: '−20.6m', loss: '8.4m', profit_raw: '-20600000', loss_raw: '8400000'
    })
    expect(overlayValues(EMPTY_STATS).profit).toBe('+0')
  })

  it('binds every repeated placeholder and supports raw numbers', () => {
    const html = renderOverlay({ ...DEFAULT_OVERLAY_APPEARANCE, overlayCustomEnabled: true,
      overlayHtml: '<b>{{profit}}</b><i>{{profit}}</i><p>{{loss_raw}}</p>', overlayCss: 'b { color: red; }'
    }, { profit: '+3m', loss_raw: '1000' })
    expect(html.match(/data-overlay-value="profit"/g)).toHaveLength(2)
    expect(html).toContain('data-overlay-value="loss_raw">1000')
    expect(html).toContain('b { color: red; }')
    expect(html).not.toContain('backdrop-filter:blur')
  })

  it('supports full HTML documents and transparent backgrounds', () => {
    const html = renderOverlay({ ...DEFAULT_OVERLAY_APPEARANCE, overlayCustomEnabled: true, overlayTransparent: true,
      overlayHtml: '<!doctype html><html><head><title>Custom</title></head><body>{{loss}}</body></html>'
    }, { loss: '50k' }, '<script>update()</script>')
    expect(html.match(/<html>/g)).toHaveLength(1)
    expect(html).toContain('background:transparent!important')
    expect(html).toContain('<script>update()</script></body>')
    expect(html).toContain('data-overlay-value="loss">50k')
  })
})

describe('live OBS overlay', () => {
  it('serves saved custom designs, refreshes values and detects design changes', async () => {
    let appearance = { ...DEFAULT_OVERLAY_APPEARANCE, overlayCustomEnabled: true,
      overlayHtml: '<strong>{{profit}}</strong><p>{{loss}}</p>' }
    let stats = { ...EMPTY_STATS, profit: 1000, lossValue: 200 }
    const server = new OverlayServer({ getTodayStats: () => stats } as StatisticsService, () => appearance)
    try {
      await server.start(0)
      const url = server.getUrl()
      const response = await fetch(url)
      const html = await response.text()
      expect(response.headers.get('content-security-policy')).toContain("script-src 'nonce-")
      expect(html).toContain('data-overlay-value="profit">+1k')
      const endpoint = new URL('/api/overlay', url)
      const original = await (await fetch(endpoint)).json()
      stats = { ...stats, profit: -2000 }
      const changed = await (await fetch(endpoint)).json()
      expect(changed.values.profit).toBe('−2k')
      expect(changed.revision).toBe(original.revision)
      const elements = ['profit', 'profit', 'loss'].map((key) => ({ getAttribute: () => key, textContent: '' }))
      let updateFinished!: () => void
      const finished = new Promise<void>((resolve) => { updateFinished = resolve })
      runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1], {
        fetch: async () => ({ ok: true, json: async () => changed }),
        document: { querySelectorAll: () => elements },
        location: { reload: () => { throw new Error('Unexpected reload') } },
        setTimeout: updateFinished
      })
      await finished
      expect(elements.map((element) => element.textContent)).toEqual(['−2k', '−2k', '200'])
      appearance = { ...appearance, overlayTransparent: true }
      const updated = await (await fetch(endpoint)).json()
      expect(updated.revision).not.toBe(original.revision)
      expect(await (await fetch(url)).text()).toContain('background:transparent!important')
      expect((await (await fetch(new URL('/api/today', url))).json()).profit).toBe(-2000)
    } finally { await server.stop() }
  })
})
