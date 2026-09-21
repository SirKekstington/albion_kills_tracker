import type { DebugEntry } from '../shared/types'

export class Diagnostics {
  private entries: DebugEntry[] = []
  constructor(readonly enabled = false) {}
  log(level: DebugEntry['level'], scope: string, message: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return
    this.entries.push({ timestamp: Date.now(), level, scope, message, data })
    if (this.entries.length > 500) this.entries.splice(0, this.entries.length - 500)
  }
  snapshot(): DebugEntry[] { return this.enabled ? [...this.entries].reverse() : [] }
}
