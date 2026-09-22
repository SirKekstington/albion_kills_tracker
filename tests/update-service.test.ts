import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { UpdateService } from '../src/main/update-service'

function fixture(seen = new Set<string>()) {
  const backend = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => { backend.emit('update-available', { version: '0.3.0' }) }),
    downloadUpdate: vi.fn(async () => { backend.emit('update-downloaded') }),
    quitAndInstall: vi.fn()
  })
  const prompt = vi.fn(async () => false)
  const service = new UpdateService(backend, '0.2.2', true, (v) => seen.has(v), (v) => seen.add(v), prompt, vi.fn())
  return { backend, prompt, service, seen }
}

describe('application updates', () => {
  it('prompts once per version across checks and restarts, never downloading on No', async () => {
    const first = fixture()
    await first.service.check(true)
    await first.service.check(true)
    expect(first.prompt).toHaveBeenCalledTimes(1)
    expect(first.backend.downloadUpdate).not.toHaveBeenCalled()
    const restart = fixture(first.seen)
    await restart.service.check(true)
    expect(restart.prompt).not.toHaveBeenCalled()
    restart.backend.checkForUpdates.mockImplementation(async () => {
      restart.backend.emit('update-available', { version: '0.4.0' })
    })
    await restart.service.check(true)
    expect(restart.prompt).toHaveBeenCalledWith('0.4.0')
  })

  it('downloads and installs after Yes and remembers the prompt first', async () => {
    const f = fixture()
    f.prompt.mockImplementation(async () => {
      expect(f.seen.has('0.3.0')).toBe(true)
      return true
    })
    await f.service.check(true)
    expect(f.backend.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(f.backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('allows updating manually after declining without another popup', async () => {
    const f = fixture()
    await f.service.check(true)
    await f.service.check()
    await f.service.install()
    expect(f.prompt).toHaveBeenCalledTimes(1)
    expect(f.backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('handles offline checks and failed downloads with retry and no extra prompt', async () => {
    const f = fixture()
    f.backend.checkForUpdates.mockRejectedValueOnce(new Error('offline'))
    expect((await f.service.check(true)).status).toBe('error')
    expect(f.seen.size).toBe(0)
    await f.service.check(true)
    f.backend.downloadUpdate.mockRejectedValueOnce(new Error('download failed'))
    expect((await f.service.install()).status).toBe('error')
    expect(f.backend.quitAndInstall).not.toHaveBeenCalled()
    await f.service.install()
    expect(f.backend.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(f.prompt).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent checks and downloads', async () => {
    const f = fixture()
    await Promise.all([f.service.check(), f.service.check()])
    expect(f.backend.checkForUpdates).toHaveBeenCalledTimes(1)
    await Promise.all([f.service.install(), f.service.install(), f.service.check()])
    expect(f.backend.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(f.backend.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(f.backend.quitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not prompt or install when current, and never checks in development', async () => {
    const f = fixture()
    f.backend.checkForUpdates.mockImplementation(async () => { f.backend.emit('update-not-available') })
    expect((await f.service.check(true)).status).toBe('current')
    await f.service.install()
    expect(f.prompt).not.toHaveBeenCalled()
    expect(f.backend.downloadUpdate).not.toHaveBeenCalled()
    f.backend.checkForUpdates.mockClear()
    const dev = new UpdateService(f.backend, '0.2.2', false, () => false, vi.fn(), f.prompt, vi.fn())
    expect((await dev.check(true)).status).toBe('disabled')
    await dev.install()
    expect(f.backend.checkForUpdates).not.toHaveBeenCalled()
    expect(f.backend.downloadUpdate).not.toHaveBeenCalled()
  })
})
