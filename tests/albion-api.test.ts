import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlbionApi } from '../src/main/albion-api'
import { Diagnostics } from '../src/main/diagnostics'

afterEach(() => vi.unstubAllGlobals())
describe('event pagination', () => {
  it('retrieves an assist after the first fifty global events', async () => {
    const fetchEvents = vi.fn(async (url: string) => new Response(JSON.stringify(new URL(url).searchParams.get('offset') === '0'
      ? Array.from({ length: 50 }, (_, i) => ({ EventId: i, TimeStamp: '2026-09-21T14:04:00Z' }))
      : [{ EventId: 437475665, TimeStamp: '2026-09-21T14:03:10Z', Participants: [{ Id: 'me' }] }])))
    vi.stubGlobal('fetch', fetchEvents)
    const events = await new AlbionApi().getRecentGlobalEvents('EUROPE', Date.parse('2026-09-21T14:00:00Z'))
    expect(events).toHaveLength(51)
    expect(events[50].Participants?.[0].Id).toBe('me')
    expect(fetchEvents).toHaveBeenCalledTimes(2)
  })

  it('retains received pages and reports a later page failure', async () => {
    const diagnostics = new Diagnostics(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(
      Array.from({ length: 50 }, (_, i) => ({ EventId: i, TimeStamp: '2026-09-21T14:04:00Z' }))
    ))).mockResolvedValueOnce(new Response('', { status: 503 })))
    const events = await new AlbionApi(diagnostics).getRecentGlobalEvents('EUROPE', Date.parse('2026-09-21T14:00:00Z'))
    expect(events).toHaveLength(50)
    expect(diagnostics.snapshot().some((entry) => entry.level === 'error' && entry.data?.offset === 50)).toBe(true)
  })
})
