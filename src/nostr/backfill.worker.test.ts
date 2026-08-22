import { describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  queries: [] as Array<{ until?: number }>,
  delivered: [] as any[],
  cacheCount: 0,
  oldestTs: null as number | null,
}))

vi.mock('nostr-tools', () => ({
  verifyEvent: () => true,
  SimplePool: class {
    ensureRelay() {
      return Promise.resolve({})
    }

    querySync(_relays: string[], filter: { until?: number }) {
      mockState.queries.push({ until: filter.until })
      const until = filter.until ?? Number.MAX_SAFE_INTEGER
      if (until > 1000) return Promise.resolve([event('old-300', 300)])
      if (until > 250) return Promise.resolve([event('old-200', 200)])
      if (until > 150) return Promise.resolve([event('old-100', 100)])
      return Promise.resolve([])
    }

    close() {}
  },
}))

function event(id: string, created_at: number) {
  return {
    id,
    pubkey: 'a'.repeat(64),
    kind: 21,
    created_at,
    content: '',
    tags: [['imeta', `url https://cdn.example.com/${id}.mp4`, 'm video/mp4']],
    sig: 'local-preview-sig',
  }
}

describe('backfill worker — mock relay pagination', () => {
  it('advances the until cursor through older pages and stops at relay history exhaustion', async () => {
    mockState.queries = []
    mockState.delivered = []
    mockState.cacheCount = 0
    mockState.oldestTs = null

    const workerScope = globalThis as any
    workerScope.self = {
      onmessage: null,
      postMessage(message: any) {
        if (message.type === 'getCacheStats') {
          queueMicrotask(() => workerScope.self.onmessage?.({
            data: {
              type: 'cacheStatsResult',
              reqId: message.reqId,
              videoCount: mockState.cacheCount,
              oldestTs: mockState.oldestTs,
            },
          } as MessageEvent))
        }
        if (message.type === 'backfillEvents') {
          mockState.delivered.push(...message.events)
          mockState.cacheCount += message.events.length
          const timestamps = message.events.map((item: any) => item.created_at)
          mockState.oldestTs = mockState.oldestTs === null
            ? Math.min(...timestamps)
            : Math.min(mockState.oldestTs, ...timestamps)
        }
      },
    }

    const { handleStartBackfill } = await import('./backfill.worker')
    await handleStartBackfill(['wss://mock-relay.example'])

    expect(mockState.queries).toHaveLength(4)
    expect(mockState.queries.slice(1).map(({ until }) => until)).toEqual([299, 199, 99])
    expect(mockState.delivered.map((item) => item.id)).toEqual(['old-300', 'old-200', 'old-100'])
  })
})
