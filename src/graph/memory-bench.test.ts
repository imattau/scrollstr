import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PolyGraph, computeEventVector } from './polygraph'
import type { PolyNode } from './types'

function makeRichEvent(id: string, kind: number, pubkey: string, ts: number, i: number): PolyNode {
  const vec = computeEventVector({ kind, pubkey, created_at: ts, eTagsCount: 2, pTagsCount: 1, hashtags: ['nostr', 'video'] })
  const content = i % 3 === 0
    ? JSON.stringify({ name: `user_${pubkey.slice(0, 8)}`, about: 'A'.repeat(200) })
    : `Check out this amazing video content with hashtags and mentions! #nostr #video https://cdn.example.com/video_${i}.mp4`
  const tags = kind === 21
    ? [['title', `Video Title ${i}`], ['t', 'nostr'], ['t', 'video'], ['imeta', `url https://cdn.example.com/video_${i}.mp4`, 'm video/mp4']]
    : [['e', `evt_${i - 1}`], ['p', pubkey]]
  return {
    id,
    type: kind === 21 || kind === 22 || kind === 1 || kind === 34236 ? 'video_shape' : 'event',
    data: { id, kind, pubkey, created_at: ts, content, tags, videoUrl: `https://cdn.example.com/video_${i}.mp4`, title: `Video Title ${i}` },
    vector: new Float64Array(vec),
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Estimate memory by measuring retained size via heap usage
function measureMemory<T>(label: string, factory: () => T): { result: T; estimatedBytes: number } {
  global.gc?.()
  const before = process.memoryUsage().heapUsed
  const result = factory()
  global.gc?.()
  const after = process.memoryUsage().heapUsed
  return { result, estimatedBytes: Math.max(0, after - before) }
}

describe('Memory benchmarks', () => {
  // Mark testTimeout high since we're doing heavy allocations
  const COUNT = 10_000
  const PUBKEYS = 200

  it.skipIf(typeof global.gc === 'undefined')('measures memory for 10K events', () => {
    const { result: graph, estimatedBytes } = measureMemory('10K events', () => {
      const g = new PolyGraph()
      for (let i = 0; i < COUNT; i++) {
        const kind = [1, 21, 22, 34236, 7, 9735, 1111, 0, 3, 10002][i % 10]
        const pubkey = `pk${String(i % PUBKEYS).padStart(64, '0')}`
        const node = makeRichEvent(`evt_${i}`, kind, pubkey, 1_700_000_000 + i, i)
        g.addNode(node)
        g.vectors.add(node.id, [...node.vector!])
        if (i % 5 === 0) g.addEdge(node.id, 'AUTHORED_BY', pubkey)
        if (i > 0 && i % 3 === 0) g.addEdge(node.id, 'REFERENCES', `evt_${i - 1}`)
      }
      return g
    })

    const perEvent = estimatedBytes / COUNT
    console.log(`\n  Memory: ${formatBytes(estimatedBytes)} total`)
    console.log(`  Per event: ${formatBytes(perEvent)}`)
    console.log(`  Nodes: ${graph.size}`)
    console.log(`  Vectors: ${graph.vectors.size}`)
    expect(graph.size).toBe(COUNT)
    expect(graph.vectors.size).toBe(COUNT)
  })

  it.skipIf(typeof global.gc === 'undefined')('measures memory for 20K events', () => {
    const count = 20_000
    const { result: graph, estimatedBytes } = measureMemory('20K events', () => {
      const g = new PolyGraph()
      for (let i = 0; i < count; i++) {
        const kind = [1, 21, 22, 34236, 7, 9735, 1111, 0, 3, 10002][i % 10]
        const pubkey = `pk${String(i % PUBKEYS).padStart(64, '0')}`
        const node = makeRichEvent(`evt_${i}`, kind, pubkey, 1_700_000_000 + i, i)
        g.addNode(node)
        g.vectors.add(node.id, [...node.vector!])
      }
      return g
    })

    const perEvent = estimatedBytes / count
    console.log(`\n  Memory: ${formatBytes(estimatedBytes)} total`)
    console.log(`  Per event: ${formatBytes(perEvent)}`)
    console.log(`  Nodes: ${graph.size}`)
    expect(graph.size).toBe(count)
  })

  it('queries 10K events in under 50ms', () => {
    const graph = new PolyGraph()
    for (let i = 0; i < COUNT; i++) {
      const kind = [1, 21, 22, 34236, 7, 9735, 1111, 0, 3, 10002][i % 10]
      const pubkey = `pk${String(i % PUBKEYS).padStart(64, '0')}`
      const node = makeRichEvent(`evt_${i}`, kind, pubkey, 1_700_000_000 + i, i)
      graph.addNode(node)
    }

    // Feed query: sort by created_at desc, limit 200
    const t0 = performance.now()
    for (let iter = 0; iter < 20; iter++) {
      const results = graph.query()
        .where('kind', 22)
        .orderBy('created_at', 'desc')
        .limit(200)
        .toArray()
      expect(results.length).toBe(200)
    }
    const t1 = performance.now()
    const avg = (t1 - t0) / 20
    console.log(`\n  Feed query (20 runs): avg ${avg.toFixed(2)}ms (${(20 / ((t1 - t0) / 1000)).toFixed(0)} qps)`)
    expect(avg).toBeLessThan(50)
  })

  it('filters by edge presence in under 100ms', () => {
    const graph = new PolyGraph()
    for (let i = 0; i < COUNT; i++) {
      graph.addNode(makeRichEvent(`evt_${i}`, 1, `pk${i % PUBKEYS}`, 1_700_000_000 + i, i))
      if (i % 5 === 0) graph.addEdge(`evt_${i}`, 'AUTHORED_BY', `pk${i % PUBKEYS}`)
    }

    const t0 = performance.now()
    for (let iter = 0; iter < 10; iter++) {
      graph.query().whereEdge('AUTHORED_BY', 'pk5').toArray()
    }
    const t1 = performance.now()
    const avg = (t1 - t0) / 10
    console.log(`\n  Edge filter (10 runs): avg ${avg.toFixed(2)}ms`)
    expect(avg).toBeLessThan(100)
  })

  it('vector similarity search speed', () => {
    const graph = new PolyGraph()
    for (let i = 0; i < COUNT; i++) {
      const kind = [22, 1, 7, 9735, 1111][i % 5]
      const v = computeEventVector({ kind, pubkey: `pk${i % PUBKEYS}`, created_at: 1_700_000_000 + i, eTagsCount: 2, pTagsCount: 1, hashtags: ['nostr'] })
      graph.vectors.add(`vec_${i}`, v)
    }

    const query = computeEventVector({ kind: 22, pubkey: 'pk5', created_at: 1_700_000_500, eTagsCount: 2, pTagsCount: 1, hashtags: ['nostr'] })
    const t0 = performance.now()
    for (let iter = 0; iter < 10; iter++) {
      graph.vectors.query(query, 20, 0.5)
    }
    const t1 = performance.now()
    const avg = (t1 - t0) / 10
    console.log(`\n  Vector search (10 runs): avg ${avg.toFixed(2)}ms`)
    expect(avg).toBeLessThan(100)
  })
})
