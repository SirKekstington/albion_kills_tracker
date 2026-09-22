import type { UpdateState } from '../shared/types'

export interface UpdateBackend {
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, listener: (...args: any[]) => void): unknown
}

export class UpdateService {
  private state: UpdateState
  private busy = false
  private promptOpen = false

  constructor(private backend: UpdateBackend, version: string, enabled: boolean,
    private prompted: (version: string) => boolean,
    private remember: (version: string) => void,
    private prompt: (version: string) => Promise<boolean>,
    private changed: () => void) {
    this.state = { currentVersion: version, status: enabled ? 'idle' : 'disabled', version: null, progress: 0 }
    backend.on('update-available', (info: { version: string }) => this.set({ status: 'available', version: info.version }))
    backend.on('update-not-available', () => this.set({ status: 'current', version: null }))
    backend.on('download-progress', (info: { percent: number }) => this.set({ progress: Math.round(info.percent) }))
    backend.on('update-downloaded', () => this.set({ status: 'downloaded', progress: 100 }))
    backend.on('error', () => this.set({ status: 'error' }))
  }

  getState(): UpdateState { return { ...this.state } }

  private set(state: Partial<UpdateState>): void {
    this.state = { ...this.state, ...state }
    this.changed()
  }

  async check(automatic = false): Promise<UpdateState> {
    if (this.busy || this.promptOpen || ['disabled', 'downloaded', 'installing'].includes(this.state.status)) return this.getState()
    this.busy = true
    this.set({ status: 'checking', version: null, progress: 0 })
    try { await this.backend.checkForUpdates() }
    catch { this.set({ status: 'error' }) }
    finally { this.busy = false }
    const version = this.state.version
    if (automatic && this.state.status === 'available' && version && !this.prompted(version)) {
      this.promptOpen = true
      try {
        // Persist before showing: dismissing or restarting must never repeat this prompt.
        this.remember(version)
        if (await this.prompt(version)) await this.install()
      } catch { this.set({ status: 'error' }) }
      finally { this.promptOpen = false }
    }
    return this.getState()
  }

  async install(): Promise<UpdateState> {
    if (this.busy) return this.getState()
    if (this.state.status === 'downloaded') {
      this.set({ status: 'installing' })
      try { this.backend.quitAndInstall() } catch { this.set({ status: 'error' }) }
      return this.getState()
    }
    if (!this.state.version || !['available', 'error'].includes(this.state.status)) return this.getState()
    this.busy = true
    this.set({ status: 'downloading', progress: 0 })
    try {
      await this.backend.downloadUpdate()
      this.set({ status: 'installing', progress: 100 })
      this.backend.quitAndInstall()
    } catch { this.set({ status: 'error' }) }
    finally { this.busy = false }
    return this.getState()
  }
}
