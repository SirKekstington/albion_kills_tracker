import http from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { StatisticsService } from './statistics-service'
import { DEFAULT_OVERLAY_APPEARANCE, overlayValues, renderOverlay } from '../shared/overlay'
import type { OverlayAppearance } from '../shared/overlay'

export class OverlayServer {
  private server: http.Server | null = null
  private port = 3847

  constructor(
    private readonly statistics: StatisticsService,
    private readonly getAppearance: () => OverlayAppearance = () => DEFAULT_OVERLAY_APPEARANCE
  ) {}

  async start(port: number): Promise<void> {
    if (this.server?.listening && this.port === port) return
    await this.stop()
    this.port = port
    this.server = http.createServer((request, response) => this.handle(request, response))
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(port, '127.0.0.1', () => resolve())
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    const current = this.server
    this.server = null
    await new Promise<void>((resolve) => current.close(() => resolve()))
  }

  getUrl(): string {
    const activePort = (this.server?.address() as AddressInfo | null)?.port ?? this.port
    return `http://127.0.0.1:${activePort}/overlay`
  }

  private handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const pathname = new URL(request.url ?? '/', `http://127.0.0.1:${this.port}`).pathname
    if (pathname === '/api/today' || pathname === '/api/overlay') {
      response.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      })
      const stats = pathname === '/api/today' ? this.statistics.getTodayStats() : this.statistics.getTrackingStats()
      response.end(JSON.stringify(pathname === '/api/today' ? stats : {
        values: overlayValues(stats, this.getAppearance().language), revision: appearanceRevision(this.getAppearance())
      }))
      return
    }
    if (pathname === '/overlay' || pathname === '/') {
      const nonce = randomUUID()
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'`
      })
      const appearance = this.getAppearance()
      const revision = appearanceRevision(appearance)
      const script = `<script nonce="${nonce}">
async function update(){
  try {
    const response = await fetch('/api/overlay', {cache:'no-store'});
    if (!response.ok) return;
    const data = await response.json();
    if (data.revision !== '${revision}') { location.reload(); return; }
    document.querySelectorAll('[data-overlay-value]').forEach((element) => {
      const value = data.values[element.getAttribute('data-overlay-value')];
      if (typeof value === 'string') element.textContent = value;
    });
  } catch {} finally { setTimeout(update, 3000); }
}
update();
</script>`
      response.end(renderOverlay(appearance, overlayValues(this.statistics.getTrackingStats(), appearance.language), script))
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }
}

function appearanceRevision(appearance: OverlayAppearance): string {
  return createHash('sha256').update(JSON.stringify([
    appearance.overlayTransparent, appearance.overlayCustomEnabled, appearance.overlayHtml, appearance.overlayCss, appearance.language ?? 'en'
  ])).digest('hex')
}
