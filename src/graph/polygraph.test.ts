import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PolyGraph, computeEventVector } from './polygraph'
import type { PolyNode } from './types'

function makeEvent(id: string, kind: number, pubkey = 'pk1', ts = 1_700_000_000): PolyNode {
  const vec = computeEventVector({ kind, pubkey, created_at: ts, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
  return {
    id,
    type: 'event',
    data: { id, kind, pubkey, created_at: ts, event: { id, kind, pubkey, content: '' }, eTags: [], pTags: [] },
    vector: new Float64Array(vec),
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function makeShape(id: string, kind: number, pubkey = 'pk1', videoUrl = 'https://example.com/video.mp4'): PolyNode {
  const vec = computeEventVector({ kind, pubkey, created_at: 1_700_000_000, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
  return {
    id,
    type: 'event',
    data: { id, kind, pubkey, created_at: 1_700_000_000, videoUrl, title: 'test', insertOrder: Date.now() * 1000 },
    vector: new Float64Array(vec),
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('PolyGraph — in-memory', () => {
  let graph: PolyGraph

  beforeEach(() => {
    graph = new PolyGraph()
  })

  describe('node CRUD', () => {
    it('adds and retrieves a node', () => {
      const node = makeEvent('evt1', 1)
      graph.addNode(node)
      expect(graph.getNode('evt1')).toBeDefined()
      expect(graph.getNode('evt1')!.data.kind).toBe(1)
    })

    it('returns undefined for missing node', () => {
      expect(graph.getNode('nonexistent')).toBeUndefined()
    })

    it('updates a node in-place', () => {
      graph.addNode(makeEvent('evt1', 1))
      graph.updateNode('evt1', { title: 'updated' })
      expect(graph.getNode('evt1')!.data.title).toBe('updated')
      expect(graph.getNode('evt1')!.data.kind).toBe(1) // original field preserved
    })

    it('removes a node', () => {
      graph.addNode(makeEvent('evt1', 1))
      graph.removeNode('evt1')
      expect(graph.getNode('evt1')).toBeUndefined()
    })

    it('size tracks node count', () => {
      graph.addNode(makeEvent('a', 1))
      graph.addNode(makeEvent('b', 2))
      expect(graph.size).toBe(2)
      graph.removeNode('a')
      expect(graph.size).toBe(1)
    })
  })

  describe('edge CRUD', () => {
    it('adds and retrieves edges', () => {
      graph.addEdge('src', 'AUTHORED_BY', 'target')
      const edges = graph.getEdges('src')
      expect(edges).toHaveLength(1)
      expect(edges[0].type).toBe('AUTHORED_BY')
      expect(edges[0].target).toBe('target')
    })

    it('deduplicates edges', () => {
      graph.addEdge('src', 'AUTHORED_BY', 'target')
      graph.addEdge('src', 'AUTHORED_BY', 'target')
      expect(graph.getEdges('src')).toHaveLength(1)
    })

    it('gets targets by type', () => {
      graph.addEdge('src', 'AUTHORED_BY', 'pk1')
      graph.addEdge('src', 'REFERENCES', 'evt1')
      graph.addEdge('src', 'REFERENCES', 'evt2')
      expect(graph.getEdgeTargets('src', 'REFERENCES')).toEqual(['evt1', 'evt2'])
    })

    it('gets sources by target and type', () => {
      graph.addEdge('a', 'AUTHORED_BY', 'pk1')
      graph.addEdge('b', 'AUTHORED_BY', 'pk1')
      graph.addEdge('c', 'REFERENCES', 'pk1')
      const sources = graph.getEdgeSources('pk1', 'AUTHORED_BY')
      expect(sources.sort()).toEqual(['a', 'b'])
    })

    it('removes edges', () => {
      graph.addEdge('src', 'REFERENCES', 'evt1')
      graph.addEdge('src', 'REFERENCES', 'evt2')
      graph.removeEdges('src', 'REFERENCES', 'evt1')
      expect(graph.getEdgeTargets('src', 'REFERENCES')).toEqual(['evt2'])
    })
  })

  describe('vector index', () => {
    it('stores and queries vectors', () => {
      const v1 = computeEventVector({ kind: 1, pubkey: 'a', created_at: 1, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
      const v2 = computeEventVector({ kind: 1, pubkey: 'a', created_at: 2, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
      graph.vectors.add('a', v1)
      graph.vectors.add('b', v2)
      const results = graph.vectors.query(v1, 5, 0.99)
      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('a')
      expect(results[0].score).toBeGreaterThan(0.99)
    })

    it('returns empty for no match', () => {
      const v = computeEventVector({ kind: 22, pubkey: 'x', created_at: 1, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
      expect(graph.vectors.query(v, 5)).toHaveLength(0)
    })
  })

  describe('query builder', () => {
    it('filters by node type', () => {
      graph.addNode(makeEvent('a', 1))
      graph.addNode(makeEvent('b', 7))
      graph.addNode({ ...makeEvent('c', 0), type: 'profile' })
      const results = graph.query().whereNodeType('event').toArray()
      expect(results).toHaveLength(2)
    })

    it('filters by attribute equality', () => {
      graph.addNode(makeEvent('a', 1))
      graph.addNode(makeEvent('b', 22))
      const results = graph.query().where('kind', 22).toArray()
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('b')
    })

    it('orders descending and limits', () => {
      for (let i = 0; i < 10; i++) {
        graph.addNode(makeEvent(`e${i}`, 1, 'pk1', 1_700_000_000 + i))
      }
      const results = graph.query()
        .where('kind', 1)
        .orderBy('created_at', 'desc')
        .limit(3)
        .toArray()
      expect(results).toHaveLength(3)
      expect(results[0].id).toBe('e9')
      expect(results[2].id).toBe('e7')
    })

    it('counts matching nodes', () => {
      graph.addNode(makeEvent('a', 1))
      graph.addNode(makeEvent('b', 22))
      graph.addNode(makeEvent('c', 22))
      expect(graph.query().where('kind', 22).count()).toBe(2)
    })
  })

  describe('change events', () => {
    it('emits on node add', () => {
      const events: any[] = []
      graph.changes.subscribe(e => events.push(e))
      graph.addNode(makeEvent('e1', 1))
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('node_added')
      expect(events[0].nodeId).toBe('e1')
    })

    it('emits on node update', () => {
      graph.addNode(makeEvent('e1', 1))
      const events: any[] = []
      graph.changes.subscribe(e => events.push(e))
      graph.updateNode('e1', { title: 'x' })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('node_updated')
    })

    it('emits on node remove', () => {
      graph.addNode(makeEvent('e1', 1))
      const events: any[] = []
      graph.changes.subscribe(e => events.push(e))
      graph.removeNode('e1')
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('node_removed')
    })

    it('emits on edge add', () => {
      const events: any[] = []
      graph.changes.subscribe(e => events.push(e))
      graph.addEdge('a', 'REFERENCES', 'b')
      expect(events.some(e => e.type === 'edge_added')).toBe(true)
    })
  })
})

describe('PolyGraph — persistence round-trip', () => {
  let graph: PolyGraph

  beforeEach(() => {
    graph = new PolyGraph()
  })

  afterEach(async () => {
    await graph.persistence.clearAll()
  })

  it('persists and reloads nodes', async () => {
    const node = makeEvent('persist-1', 1, 'pk1', 1_700_000_000)
    graph.addNode(node)
    graph.vectors.add(node.id, [...node.vector!])
    await graph.flush()

    const graph2 = new PolyGraph()
    await graph2.warm()
    expect(graph2.size).toBe(1)
    const loaded = graph2.getNode('persist-1')
    expect(loaded).toBeDefined()
    expect(loaded!.data.kind).toBe(1)
  })

  it('persists and reloads edges', async () => {
    graph.addNode(makeEvent('e1', 1))
    graph.addNode(makeEvent('e2', 22))
    graph.addEdge('e1', 'REFERENCES', 'e2')
    await graph.flush()

    const graph2 = new PolyGraph()
    await graph2.warm()
    const edgeTargets = graph2.getEdgeTargets('e1', 'REFERENCES')
    expect(edgeTargets).toEqual(['e2'])
  })

  it('persists and reloads vectors', async () => {
    const node = makeEvent('v-test', 22)
    graph.addNode(node)
    graph.vectors.add(node.id, [...node.vector!])
    await graph.flush()

    const graph2 = new PolyGraph()
    await graph2.warm()
    expect(graph2.vectors.size).toBe(1)
    expect(graph2.vectors.has('v-test')).toBe(true)
  })

  it('survives multiple flush cycles', async () => {
    graph.addNode(makeEvent('a', 1))
    await graph.flush()
    graph.addNode(makeEvent('b', 22))
    await graph.flush()
    graph.addNode(makeEvent('c', 34236))
    await graph.flush()

    const graph2 = new PolyGraph()
    await graph2.warm()
    expect(graph2.size).toBe(3)
  })

  it('removes nodes from persistence on delete', async () => {
    graph.addNode(makeEvent('del-test', 1))
    await graph.flush()
    graph.removeNode('del-test')
    await graph.flush()

    const graph2 = new PolyGraph()
    await graph2.warm()
    expect(graph2.getNode('del-test')).toBeUndefined()
  })

  it('handles empty graph warm-up', async () => {
    const graph2 = new PolyGraph()
    await graph2.warm()
    expect(graph2.size).toBe(0)
  })
})

describe('PolyGraph — hot cache eviction', () => {
  let graph: PolyGraph

  beforeEach(() => {
    graph = new PolyGraph()
  })

  afterEach(async () => {
    await graph.persistence.clearAll()
  })

  it('keeps all nodes within HOT_CACHE_MAX', () => {
    const COUNT = 10000
    for (let i = 0; i < COUNT; i++) {
      const node = makeEvent(`keep-${i}`, 1, 'pk1', 1_700_000_000 + i)
      graph.addNode(node)
    }
    expect(graph.size).toBe(COUNT)
  })

  it('touchHotCache preserves accessed nodes', () => {
    const COUNT = 5100
    for (let i = 0; i < COUNT; i++) {
      const node = makeEvent(`t-${i}`, 1, 'pk1', 1_700_000_000 + i)
      graph.addNode(node)
    }
    graph.getNode('t-0')
    expect(graph.getNode('t-0')).toBeDefined()
    expect(graph.getNode('t-5099')).toBeDefined()
  })
})

describe('PolyGraph — stress', () => {
  let graph: PolyGraph

  beforeEach(() => {
    graph = new PolyGraph()
  })

  afterEach(async () => {
    await graph.persistence.clearAll()
  })

  it('inserts 10K events and queries by kind', () => {
    const COUNT = 10_000
    for (let i = 0; i < COUNT; i++) {
      const kind = [1, 21, 22, 34236, 7, 9735, 1111, 0, 3, 10002][i % 10]
      const node = makeEvent(`s-${i}`, kind, `pk${i % 50}`, 1_700_000_000 + i)
      graph.addNode(node)
      graph.vectors.add(node.id, [...node.vector!])
    }
    expect(graph.size).toBe(COUNT)

    const kind22 = graph.query().where('kind', 22).count()
    expect(kind22).toBeGreaterThanOrEqual(COUNT / 10 - 1)

    const top200 = graph.query()
      .where('kind', 1)
      .orderBy('created_at', 'desc')
      .limit(200)
      .toArray()
    expect(top200).toHaveLength(200)
  })

  it('filters by edge presence', () => {
    for (let i = 0; i < 100; i++) {
      graph.addNode(makeEvent(`e${i}`, 1, `pk${i % 10}`))
    }
    graph.addEdge('e0', 'REFERENCES', 'e1')
    graph.addEdge('e5', 'REFERENCES', 'e1')

    const refs = graph.query().whereEdge('REFERENCES', 'e1').count()
    expect(refs).toBe(2)
  })

  it('vector index handles 10K entries', () => {
    for (let i = 0; i < 10_000; i++) {
      const v = computeEventVector({
        kind: i % 7 === 0 ? 22 : 1,
        pubkey: `pk${i % 100}`,
        created_at: 1_700_000_000 + i,
        eTagsCount: i % 3,
        pTagsCount: i % 2,
        hashtags: [],
      })
      graph.vectors.add(`vec-${i}`, v)
    }

    const query = computeEventVector({ kind: 22, pubkey: 'pk5', created_at: 1_700_000_500, eTagsCount: 1, pTagsCount: 0, hashtags: [] })
    const results = graph.vectors.query(query, 10, 0.5)
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].score).toBeGreaterThanOrEqual(0)
  })
})
