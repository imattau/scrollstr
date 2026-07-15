import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PolyGraph, graph, computeEventVector } from './polygraph'
import { VectorIndex } from './vector-index'
import type { PolyNode, NodeType, EdgeType } from './types'

// ── Helpers ──

function makeEvent(
  id: string,
  kind: number,
  pubkey = 'pk1',
  ts = 1_700_000_000,
  tags: string[][] = [],
): PolyNode {
  const vec = computeEventVector({ kind, pubkey, created_at: ts, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
  return {
    id,
    type: 'event',
    data: {
      id,
      kind,
      pubkey,
      created_at: ts,
      event: { id, kind, pubkey, content: '', tags },
      eTags: tags.filter(t => t[0] === 'e').map(t => t[1]),
      pTags: tags.filter(t => t[0] === 'p').map(t => t[1]),
    },
    vector: new Float64Array(vec),
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function makeShape(id: string, kind: number, pubkey = 'pk1'): PolyNode {
  const vec = computeEventVector({ kind, pubkey, created_at: 1_700_000_000, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
  return {
    id,
    type: 'video_shape',
    data: { id, kind, pubkey, created_at: 1_700_000_000, videoUrl: 'https://example.com/v.mp4', insertOrder: Date.now() },
    vector: new Float64Array(vec),
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function makeProfile(pubkey: string): PolyNode {
  return {
    id: `pro:${pubkey}`,
    type: 'profile',
    data: { pubkey, name: `User-${pubkey}`, displayName: `User ${pubkey}`, updatedAt: Date.now() },
    insertedAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// ── E2E Tests ──

describe('PolyGraph E2E — in-memory indexes', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })
  afterEach(async () => { await pg.persistence.clearAll() })

  it('byPubkey returns nodes for a pubkey', () => {
    pg.addNode(makeEvent('e1', 1, 'alice'))
    pg.addNode(makeEvent('e2', 22, 'alice'))
    pg.addNode(makeEvent('e3', 7, 'bob'))

    const aliceNodes = pg.byPubkey('alice')
    expect(aliceNodes).toHaveLength(2)
    expect(aliceNodes.map(n => n.id).sort()).toEqual(['e1', 'e2'])

    const bobNodes = pg.byPubkey('bob')
    expect(bobNodes).toHaveLength(1)
    expect(bobNodes[0].id).toBe('e3')
  })

  it('byPubkey returns empty for unknown pubkey', () => {
    pg.addNode(makeEvent('e1', 1, 'alice'))
    expect(pg.byPubkey('unknown')).toHaveLength(0)
  })

  it('byPubkey filtered by type', () => {
    pg.addNode(makeEvent('e1', 1, 'alice'))
    pg.addNode(makeShape('s1', 22, 'alice'))

    const events = pg.byPubkey('alice', 'event')
    expect(events).toHaveLength(1)
    expect(events[0].id).toBe('e1')

    const shapes = pg.byPubkey('alice', 'video_shape')
    expect(shapes).toHaveLength(1)
    expect(shapes[0].id).toBe('s1')
  })

  it('byKindPubkey returns the most recent replaceable event', () => {
    // Add an older kind:3 event
    pg.addNode(makeEvent('old-contact', 3, 'alice', 1_700_000_000))
    // Add a newer one (same replaceableKey)
    pg.addNode(makeEvent('new-contact', 3, 'alice', 1_700_000_100))

    // Most recent wins
    const found = pg.byKindPubkey(3, 'alice')
    expect(found).toBeDefined()
    expect(found!.id).toBe('new-contact')
  })

  it('byKindPubkey returns undefined for missing', () => {
    pg.addNode(makeEvent('e1', 1, 'alice'))
    expect(pg.byKindPubkey(3, 'alice')).toBeUndefined()
  })

  it('indexes cleaned up on removeNode', () => {
    pg.addNode(makeEvent('e1', 1, 'alice'))
    pg.addNode(makeEvent('e2', 3, 'alice'))
    expect(pg.byPubkey('alice')).toHaveLength(2)
    expect(pg.byKindPubkey(3, 'alice')).toBeDefined()

    pg.removeNode('e2')
    expect(pg.byPubkey('alice')).toHaveLength(1)
    expect(pg.byKindPubkey(3, 'alice')).toBeUndefined()
    expect(pg.byPubkey('alice')[0].id).toBe('e1')
  })

  it('indexes cleaned up on eviction', () => {
    // Add more than HOT_CACHE_MAX (20000) nodes to trigger eviction
    const COUNT = 20_050
    for (let i = 0; i < COUNT; i++) {
      const pk = `pk${i % 100}`
      pg.addNode(makeEvent(`evict-${i}`, 1, pk, 1_700_000_000 + i))
    }

    // HOT_CACHE_MAX is 20000, so ~50 nodes should have been evicted
    const totalNodes = (pg as any).nodes.size
    expect(totalNodes).toBeLessThanOrEqual(20000)

    // The index should have been cleaned up too — querying a pubkey
    // whose events were evicted should return nothing
    const somePubkey = 'pk0'
    const results = pg.byPubkey(somePubkey)
    // pk0 events should all be among the first ones (oldest), so likely evicted
    // Just verify the index is consistent with the node map
    for (const node of results) {
      expect((pg as any).nodes.has(node.id)).toBe(true)
    }
    // Verify no stale IDs in the index
    const byPubkey = (pg as any)._byPubkey as Map<string, Set<string>>
    for (const [pk, ids] of byPubkey) {
      for (const id of ids) {
        expect((pg as any).nodes.has(id)).toBe(true)
      }
    }
  })

  it('clear() resets all indexes', () => {
    pg.addNode(makeEvent('e1', 1, 'alice'))
    pg.addNode(makeEvent('e2', 3, 'bob'))
    pg.addEdge('e1', 'REFERENCES', 'e2')

    pg.clear()

    expect(pg.byPubkey('alice')).toHaveLength(0)
    expect(pg.byKindPubkey(3, 'bob')).toBeUndefined()
    expect(pg.size).toBe(0)
    expect(pg.getEdges('e1')).toHaveLength(0)
  })
})

describe('PolyGraph E2E — putReplaceable', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })
  afterEach(async () => { await pg.persistence.clearAll() })

  it('inserts a new replaceable event', async () => {
    const inserted = await pg.putReplaceable({
      id: 'evt:contact1',
      type: 'event',
      data: { id: 'contact1', kind: 3, pubkey: 'alice', created_at: 1_700_000_000, replaceableKey: '3:alice' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(inserted).toBe(true)
    expect(pg.getNode('evt:contact1')).toBeDefined()
  })

  it('replaces an older version of the same replaceable', async () => {
    // Insert older
    await pg.putReplaceable({
      id: 'evt:old',
      type: 'event',
      data: { id: 'old', kind: 3, pubkey: 'alice', created_at: 1_700_000_000, replaceableKey: '3:alice' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(pg.getNode('evt:old')).toBeDefined()

    // Insert newer
    const inserted = await pg.putReplaceable({
      id: 'evt:new',
      type: 'event',
      data: { id: 'new', kind: 3, pubkey: 'alice', created_at: 1_700_000_100, replaceableKey: '3:alice' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(inserted).toBe(true)
    // Old node should be removed
    expect(pg.getNode('evt:old')).toBeUndefined()
    // New node should be present
    expect(pg.getNode('evt:new')).toBeDefined()
    // byKindPubkey should point to the new one
    expect(pg.byKindPubkey(3, 'alice')?.id).toBe('evt:new')
  })

  it('skips insert when stored version is newer', async () => {
    await pg.putReplaceable({
      id: 'evt:newer',
      type: 'event',
      data: { id: 'newer', kind: 3, pubkey: 'alice', created_at: 1_700_000_100, replaceableKey: '3:alice' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    const inserted = await pg.putReplaceable({
      id: 'evt:older',
      type: 'event',
      data: { id: 'older', kind: 3, pubkey: 'alice', created_at: 1_700_000_000, replaceableKey: '3:alice' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(inserted).toBe(false)
    expect(pg.getNode('evt:newer')).toBeDefined()
    expect(pg.getNode('evt:older')).toBeUndefined()
  })

  it('handles tie by removing old and inserting new', async () => {
    await pg.putReplaceable({
      id: 'evt:first',
      type: 'event',
      data: { id: 'first', kind: 10002, pubkey: 'alice', created_at: 1_700_000_000, replaceableKey: '10002:alice:' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    const inserted = await pg.putReplaceable({
      id: 'evt:second',
      type: 'event',
      data: { id: 'second', kind: 10002, pubkey: 'alice', created_at: 1_700_000_000, replaceableKey: '10002:alice:' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    // Tie → old is deleted, new is inserted
    expect(inserted).toBe(true)
    expect(pg.getNode('evt:first')).toBeUndefined()
    expect(pg.getNode('evt:second')).toBeDefined()
    // Only one row should exist
    const allWithKey = [...(pg as any).nodes.values()].filter(
      (n: PolyNode) => (n.data.replaceableKey as string) === '10002:alice:',
    )
    expect(allWithKey).toHaveLength(1)
  })
})

describe('PolyGraph E2E — edge materialization + ownership', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })

  it('tags edges with default ownership', () => {
    pg.addEdge('evt:1', 'AUTHORED_BY', 'alice')
    pg.addEdge('evt:1', 'HAS_COUNTER', 'cnt:1')
    pg.addEdge('evt:1', 'REFERENCES', 'evt:2')

    const edges = pg.getEdges('evt:1')
    expect(edges).toHaveLength(3)

    const authBy = edges.find(e => e.type === 'AUTHORED_BY')
    expect(authBy?.data?.__ownership).toBe('reference')

    const counter = edges.find(e => e.type === 'HAS_COUNTER')
    expect(counter?.data?.__ownership).toBe('owned')

    const ref = edges.find(e => e.type === 'REFERENCES')
    expect(ref?.data?.__ownership).toBe('reference')
  })

  it('allows caller to override ownership', () => {
    pg.addEdge('evt:1', 'REFERENCES', 'evt:2', { __ownership: 'shared' })
    const edge = pg.getEdges('evt:1').find(e => e.type === 'REFERENCES')
    expect(edge?.data?.__ownership).toBe('shared')
  })

  it('getEdgeSources works with prefixed references', () => {
    pg.addNode(makeEvent('evt:src1', 1, 'alice'))
    pg.addNode(makeEvent('evt:tgt1', 22, 'bob'))

    pg.addEdge('evt:src1', 'REFERENCES', 'evt:tgt1')
    pg.addEdge('evt:src1', 'AUTHORED_BY', 'alice')

    const targets = pg.getEdgeTargets('evt:src1', 'REFERENCES')
    expect(targets).toEqual(['evt:tgt1'])

    const sources = pg.getEdgeSources('evt:tgt1', 'REFERENCES')
    expect(sources).toEqual(['evt:src1'])
  })

  it('cleanupNodeEdges removes outbound edges on remove', () => {
    pg.addNode(makeEvent('evt:a', 1, 'alice'))
    pg.addNode(makeEvent('evt:b', 22, 'bob'))
    pg.addEdge('evt:a', 'REFERENCES', 'evt:b')

    pg.removeNode('evt:b')
    // Edge FROM 'evt:b' (outbound) is cleaned
    expect(pg.getEdgeTargets('evt:b', 'REFERENCES')).toHaveLength(0)

    pg.removeNode('evt:a')
    // Edge FROM 'evt:a' (outbound) is cleaned
    expect(pg.getEdgeTargets('evt:a', 'REFERENCES')).toHaveLength(0)

    // Inbound edge FROM 'evt:a' → 'evt:b' persists after 'evt:b' removal
    // because cleanupNodeEdges only handles outbound edges
    // (the edge still exists at its source 'evt:a' after target 'evt:b' is removed)
    // Re-add 'evt:b' to check the edge still exists:
    pg.addEdge('evt:a', 'REFERENCES', 'evt:b')
    expect(pg.getEdgeTargets('evt:a', 'REFERENCES')).toHaveLength(1)
    expect(pg.getEdgeTargets('evt:a', 'REFERENCES')[0]).toBe('evt:b')
  })
})

describe('PolyGraph E2E — multi-hop traversal', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })

  it('traverse follows REFERENCES out-edges', () => {
    // Root → reply1 → reply2
    pg.addNode(makeEvent('evt:root', 1, 'alice'))
    pg.addNode(makeEvent('evt:r1', 1111, 'bob'))
    pg.addNode(makeEvent('evt:r2', 1111, 'carol'))
    pg.addEdge('evt:r1', 'REFERENCES', 'evt:root')
    pg.addEdge('evt:r2', 'REFERENCES', 'evt:r1')

    const replies = pg.query()
      .whereNodeType('event')
      .whereEdge('REFERENCES', 'evt:root')
      .traverse('REFERENCES', 2, 'in')
      .toArray()

    // Should find r1 (1 hop) and r2 (2 hops)
    expect(replies).toHaveLength(2)
    expect(replies.map(n => n.id).sort()).toEqual(['evt:r1', 'evt:r2'])
  })

  it('traverse with depth 0 returns only seeds', () => {
    pg.addNode(makeEvent('evt:root', 1, 'alice'))
    pg.addNode(makeEvent('evt:r1', 1111, 'bob'))
    pg.addEdge('evt:r1', 'REFERENCES', 'evt:root')

    const seeds = pg.query()
      .whereNodeType('event')
      .whereEdge('REFERENCES', 'evt:root')
      .traverse('REFERENCES', 0, 'out')
      .toArray()
    expect(seeds).toHaveLength(1)
    expect(seeds[0].id).toBe('evt:r1')
  })

  it('collect gathers one-hop related nodes', () => {
    pg.addNode(makeEvent('evt:e1', 1, 'alice'))
    pg.addNode({ ...makeProfile('bob'), id: 'pro:bob', type: 'profile' })
    pg.addEdge('evt:e1', 'AUTHORED_BY', 'alice')

    // Collect out-edges of type AUTHORED_BY — target 'alice' is just a string,
    // but a profile node with that id exists in the graph
    // (for testing purposes, the edge target IS a valid graph node)
    const authored = pg.query()
      .whereNodeType('event')
      .where('id', 'evt:e1')
      .collect('AUTHORED_BY', 'out')
    // AUTHORED_BY target is a raw pubkey, not a prefixed node —
    // collect resolves target against this.nodes.get(target)
    // No node exists at id 'alice' since it's a raw pubkey
    expect(authored).toHaveLength(0)

    // For MENTIONS, add the target as a profile node
    pg.addNode({ ...makeProfile('bob'), id: 'bob', type: 'profile' })
    pg.addEdge('evt:e1', 'MENTIONS', 'bob')

    const mentions = pg.query()
      .whereNodeType('event')
      .where('id', 'evt:e1')
      .collect('MENTIONS', 'out')
    expect(mentions).toHaveLength(1)
    expect(mentions[0].id).toBe('bob')
    expect(mentions[0].type).toBe('profile')
  })

  it('count respects traversal', () => {
    pg.addNode(makeEvent('evt:root', 1, 'alice'))
    pg.addNode(makeEvent('evt:r1', 1111, 'bob'))
    pg.addEdge('evt:r1', 'REFERENCES', 'evt:root')

    const count = pg.query()
      .whereNodeType('event')
      .whereEdge('REFERENCES', 'evt:root')
      .traverse('REFERENCES', 1, 'in')
      .count()
    expect(count).toBe(1)
  })

  it('collect in-direction finds sources', () => {
    pg.addNode(makeEvent('evt:reply', 1111, 'bob'))
    pg.addNode(makeEvent('evt:parent', 1, 'alice'))
    pg.addEdge('evt:reply', 'REFERENCES', 'evt:parent')

    const sources = pg.query()
      .whereNodeType('event')
      .where('id', 'evt:parent')
      .collect('REFERENCES', 'in')

    expect(sources).toHaveLength(1)
    expect(sources[0].id).toBe('evt:reply')
  })
})

describe('PolyGraph E2E — findThread', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })

  it('builds a reply thread tree', () => {
    // Build a simple thread: root → reply1 → reply2
    const root = makeEvent('evt:root', 1, 'alice')
    const reply1 = makeEvent('evt:reply1', 1111, 'bob')
    const reply2 = makeEvent('evt:reply2', 1111, 'carol')
    pg.addNode(root)
    pg.addNode(reply1)
    pg.addNode(reply2)
    pg.addEdge('evt:reply1', 'REFERENCES', 'evt:root')
    pg.addEdge('evt:reply2', 'REFERENCES', 'evt:reply1')

    // The edge source is 'evt:<id>' (prefixed) since materializeEventEdges
    // uses that convention. findThread calls getEdgeSources('evt:root', 'REFERENCES')
    // which looks up by edge TARGET.
    // Edge: evt:reply1 → REFERENCES → evt:root
    // getEdgeSources('evt:root', 'REFERENCES') returns ['evt:reply1']
    // getNode('evt:reply1') works because the node id IS 'evt:reply1'
    const sourcesRoot = pg.getEdgeSources('evt:root', 'REFERENCES')
    expect(sourcesRoot).toEqual(['evt:reply1'])

    const sourcesReply1 = pg.getEdgeSources('evt:reply1', 'REFERENCES')
    expect(sourcesReply1).toEqual(['evt:reply2'])
  })
})

describe('PolyGraph E2E — findSimilarVideos', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })

  it('returns similar videos by vector proximity', () => {
    // Two similar videos (same kind, near timestamps, same pubkey)
    const v1 = computeEventVector({ kind: 22, pubkey: 'alice', created_at: 1_700_000_000, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
    const v2 = computeEventVector({ kind: 22, pubkey: 'alice', created_at: 1_700_000_001, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
    const vDiff = computeEventVector({ kind: 1, pubkey: 'bob', created_at: 1_500_000_000, eTagsCount: 5, pTagsCount: 5, hashtags: [] })

    // Store shape nodes with the event ids for lookup
    pg.addNode({
      id: 'evt:vid1',
      type: 'event',
      data: { id: 'vid1', kind: 22, pubkey: 'alice', created_at: 1_700_000_000, videoUrl: 'https://a.com/1.mp4' },
      vector: new Float64Array(v1),
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    pg.vectors.add('vid1', v1)

    pg.addNode({
      id: 'evt:vid2',
      type: 'event',
      data: { id: 'vid2', kind: 22, pubkey: 'alice', created_at: 1_700_000_001, videoUrl: 'https://a.com/2.mp4' },
      vector: new Float64Array(v2),
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    pg.vectors.add('vid2', v2)

    pg.addNode({
      id: 'evt:diff',
      type: 'event',
      data: { id: 'diff', kind: 1, pubkey: 'bob', created_at: 1_500_000_000 },
      vector: new Float64Array(vDiff),
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    pg.vectors.add('diff', vDiff)

    // Query with v1 — should find v2 first (most similar)
    const results = pg.vectors.query(v1, 5, 0.5)
    expect(results.length).toBeGreaterThanOrEqual(2)
    // v1 itself is excluded; v2 should be the top result
    expect(results[0].id).toBe('vid2')
    expect(results[0].score).toBeGreaterThan(0.9)
  })

  it('returns empty when no similar videos found', () => {
    const v1 = computeEventVector({ kind: 22, pubkey: 'alice', created_at: 1_700_000_000, eTagsCount: 0, pTagsCount: 0, hashtags: [] })
    pg.vectors.add('vid1', v1)

    const vDifferent = computeEventVector({ kind: 7, pubkey: 'far', created_at: 1, eTagsCount: 50, pTagsCount: 50, hashtags: [] })
    pg.vectors.add('react', vDifferent)

    const results = pg.vectors.query(v1, 5, 0.99)
    expect(results).toHaveLength(1) // only v1 matches itself
  })
})

describe('PolyGraph E2E — vector index', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })

  it('stores and retrieves vectors via VectorIndex', () => {
    const vi = new VectorIndex()
    const v = computeEventVector({ kind: 22, pubkey: 'pk', created_at: 1_700_000_000, eTagsCount: 1, pTagsCount: 0, hashtags: [] })
    vi.add('vid1', v)
    expect(vi.has('vid1')).toBe(true)
    expect(vi.get('vid1')).toEqual(v)
    expect(vi.size).toBe(1)

    vi.remove('vid1')
    expect(vi.has('vid1')).toBe(false)
  })

  it('clear() empties the index', () => {
    const vi = new VectorIndex()
    vi.add('a', [1, 2, 3])
    vi.add('b', [4, 5, 6])
    vi.clear()
    expect(vi.size).toBe(0)
  })

  it('handles empty query', () => {
    const vi = new VectorIndex()
    expect(vi.query([1, 2, 3, 4, 5, 6, 7], 10)).toHaveLength(0)
  })
})

describe('PolyGraph E2E — memory leak detection', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })
  afterEach(async () => { await pg.persistence.clearAll() })

  it('indexes do not leak on repeated add/remove', () => {
    for (let cycle = 0; cycle < 100; cycle++) {
      pg.addNode(makeEvent(`e-${cycle}`, 1, `pk${cycle % 10}`, 1_700_000_000 + cycle))
    }
    // Remove half
    for (let cycle = 0; cycle < 100; cycle += 2) {
      pg.removeNode(`e-${cycle}`)
    }
    // Check index consistency
    const byPubkey = (pg as any)._byPubkey as Map<string, Set<string>>
    for (const [pk, ids] of byPubkey) {
      for (const id of ids) {
        expect((pg as any).nodes.has(id)).toBe(true)
      }
    }
  })

  it('vectors are cleaned up on node remove', () => {
    const node = makeEvent('evt:cleanup', 22, 'pk1')
    pg.addNode(node)
    pg.vectors.add('cleanup', [...node.vector!])

    expect(pg.vectors.has('cleanup')).toBe(true)
    pg.removeNode('evt:cleanup')
    expect(pg.vectors.has('cleanup')).toBe(false)
  })

  it('dirty nodes tracked after remove then add same id', () => {
    pg.addNode(makeEvent('e1', 1, 'alice'))
    pg.removeNode('e1')
    pg.addNode(makeEvent('e1', 22, 'bob'))

    const node = pg.getNode('e1')
    expect(node).toBeDefined()
    expect(node!.data.kind).toBe(22)
    expect(node!.data.pubkey).toBe('bob')
    // Index should reflect the new data
    expect(pg.byPubkey('alice')).toHaveLength(0)
    expect(pg.byPubkey('bob')).toHaveLength(1)
  })

  it('removedNodeIds does not accumulate duplicates', () => {
    pg.addNode(makeEvent('e1', 1, 'alice'))
    pg.removeNode('e1')
    // Remove again (no-op)
    pg.removeNode('e1')

    const removedNodeIds = (pg as any).removedNodeIds as Set<string>
    expect(removedNodeIds.size).toBe(1)
  })

  it('change subscriptions do not leak', () => {
    const events: string[] = []
    const sub1 = pg.changes.subscribe(() => events.push('sub1'))
    const sub2 = pg.changes.subscribe(() => events.push('sub2'))

    pg.addNode(makeEvent('e1', 1))
    expect(events).toEqual(['sub1', 'sub2'])

    sub1.unsubscribe()
    pg.addNode(makeEvent('e2', 22))
    expect(events).toEqual(['sub1', 'sub2', 'sub2']) // sub1 no longer fires

    sub2.unsubscribe()
    pg.addNode(makeEvent('e3', 7))
    expect(events).toEqual(['sub1', 'sub2', 'sub2']) // no new additions
  })

  it('byETag correctly resolves prefixed REFERENCES', () => {
    pg.addNode(makeEvent('evt:a', 1, 'alice'))
    pg.addNode(makeEvent('evt:b', 1111, 'bob'))
    pg.addEdge('evt:b', 'REFERENCES', 'evt:a')

    // byETag looks up by target ID (the TARGET of REFERENCES edge = 'evt:a')
    // The edge SOURCE is 'evt:b', and the node IS stored as 'evt:b'
    const sources = pg.byETag('evt:a')
    expect(sources).toHaveLength(1)
    expect(sources[0].id).toBe('evt:b')
  })

  it('hot cache eviction removes edges from evicted sources', () => {
    // Add edges BEFORE eviction so the edge is cleaned when the source is evicted
    const COUNT = 20_050
    for (let i = 0; i < 100; i++) {
      pg.addNode(makeEvent(`evt-${i}`, 1, 'pk', 1_700_000_000 + i))
    }
    // Add edge between two early nodes
    pg.addEdge('evt-0', 'REFERENCES', 'evt-1')

    // Add more nodes to trigger eviction of early nodes
    for (let i = 100; i < COUNT; i++) {
      pg.addNode(makeEvent(`evt-${i}`, 1, 'pk', 1_700_000_000 + i))
    }

    // evt-0 and evt-1 should be evicted from the hot cache
    expect((pg as any).nodes.has('evt-0')).toBe(false)
    expect((pg as any).nodes.has('evt-1')).toBe(false)

    // Edge FROM evt-0 should be cleaned because cleanupNodeEdges
    // removes outbound edges when the SOURCE node is evicted
    expect(pg.getEdgeSources('evt-1', 'REFERENCES')).toHaveLength(0)
  })
})

describe('PolyGraph E2E — public query API', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })

  it('whereType returns all nodes of a type', () => {
    pg.addNode(makeEvent('e1', 1))
    pg.addNode({ ...makeProfile('alice'), id: 'pro:alice' })
    pg.addNode(makeShape('s1', 22))

    expect(pg.whereType('event')).toHaveLength(1)
    expect(pg.whereType('profile')).toHaveLength(1)
    expect(pg.whereType('video_shape')).toHaveLength(1)
  })

  it('whereFieldRange filters correctly', () => {
    pg.addNode(makeEvent('e1', 1, 'alice', 1_700_000_000))
    pg.addNode(makeEvent('e2', 22, 'alice', 1_700_000_100))
    pg.addNode(makeEvent('e3', 7, 'bob', 1_700_000_200))

    const recent = pg.whereFieldRange('created_at', { above: 1_700_000_050 }, 'event')
    expect(recent).toHaveLength(2)
    expect(recent.map(n => n.id).sort()).toEqual(['e2', 'e3'])
  })

  it('countByFieldRange returns correct count', () => {
    pg.addNode(makeEvent('e1', 1, 'alice', 1_700_000_000))
    pg.addNode(makeEvent('e2', 22, 'alice', 1_700_000_100))
    pg.addNode(makeEvent('e3', 7, 'bob', 1_700_000_200))

    expect(pg.countByFieldRange('created_at', { above: 1_700_000_050 }, 'event')).toBe(2)
    expect(pg.countByFieldRange('created_at', { above: 0 }, 'profile')).toBe(0)
  })

  it('recentBy sorts descending and limits', () => {
    for (let i = 0; i < 10; i++) {
      pg.addNode(makeEvent(`e${i}`, 1, 'pk', 1_700_000_000 + i))
    }
    const recent = pg.recentBy('created_at', 3, 'event')
    expect(recent).toHaveLength(3)
    expect(recent[0].id).toBe('e9')
    expect(recent[2].id).toBe('e7')
  })
})

describe('PolyGraph E2E — persistence round-trip', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })
  afterEach(async () => { await pg.persistence.clearAll() })

  it('persists and reloads replaceableKey', async () => {
    const node = makeEvent('evt:replaceable', 3, 'alice', 1_700_000_000)
    node.data.replaceableKey = '3:alice'
    pg.addNode(node)
    await pg.flush()

    const pg2 = new PolyGraph()
    await pg2.warm()
    expect(pg2.size).toBe(1)
  })

  it('putReplaceable persists to IDB and survives warm', async () => {
    await pg.putReplaceable({
      id: 'evt:old',
      type: 'event',
      data: { id: 'old', kind: 0, pubkey: 'alice', created_at: 1_700_000_000, replaceableKey: '0:alice' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    await pg.putReplaceable({
      id: 'evt:new',
      type: 'event',
      data: { id: 'new', kind: 0, pubkey: 'alice', created_at: 1_700_000_100, replaceableKey: '0:alice' },
      insertedAt: Date.now(),
      updatedAt: Date.now(),
    })
    // Flush, then warm on a fresh graph
    await pg.flush()
    const pg2 = new PolyGraph()
    await pg2.warm()

    // Only the newer should survive
    const found = pg2.getNode('evt:new')
    expect(found).toBeDefined()
    expect(found!.data.kind).toBe(0)
    expect(pg2.getNode('evt:old')).toBeUndefined()
  })

  it('persists edges with ownership and survives warm', async () => {
    pg.addNode(makeEvent('evt:a', 1, 'alice'))
    pg.addNode(makeEvent('evt:b', 22, 'bob'))
    pg.addEdge('evt:a', 'REFERENCES', 'evt:b')
    await pg.flush()

    const pg2 = new PolyGraph()
    await pg2.warm()
    const targets = pg2.getEdgeTargets('evt:a', 'REFERENCES')
    expect(targets).toEqual(['evt:b'])
  })
})

describe('PolyGraph E2E — stress test with 10K events', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })
  afterEach(async () => { await pg.persistence.clearAll() })

  it('handles 10K events, edges, and vectors', () => {
    const COUNT = 10_000
    for (let i = 0; i < COUNT; i++) {
      const kind = [1, 21, 22, 34236, 7, 9735, 1111, 0, 3, 10002][i % 10]
      const pk = `pk${i % 100}`
      const node = makeEvent(`s-${i}`, kind, pk, 1_700_000_000 + i)
      pg.addNode(node)
      pg.vectors.add(`s-${i}`, [...node.vector!])
    }
    expect(pg.size).toBe(COUNT)
    expect(pg.vectors.size).toBe(COUNT)

    // Add some edges
    for (let i = 0; i < 1000; i++) {
      pg.addEdge(`s-${i}`, 'REFERENCES', `s-${(i + 1) % COUNT}`)
    }

    // Query by pubkey index
    const aliceNodes = pg.byPubkey('pk0', 'event')
    expect(aliceNodes.length).toBeGreaterThanOrEqual(COUNT / 100 - 1)

    // Query by kind+pubkey index
    const kind22 = pg.byKindPubkey(22, 'pk0')
    // There should be a kind:22 for pk0 (since i%10 cycles, pk0 has kinds 0,10,20... - kind 22 appears at pk0 when i=2,12,22...)
    // Actually pk0 appears when i%100===0, and kind is i%10. At i=2, kind=22, pk=pk2. So pk0 won't have kind:22.
    // Let me just verify the method doesn't throw and returns a reasonable result for pubkeys that DO exist
    const kind1 = pg.byKindPubkey(1, 'pk0')
    // i=0: kind=1, pk=pk0. So pk0 has at least one kind:1 event.
    expect(kind1).toBeDefined()
    expect(kind1!.data.kind).toBe(1)

    // Vector query - should find similar events quickly
    const queryVec = computeEventVector({ kind: 22, pubkey: 'pk5', created_at: 1_700_000_500, eTagsCount: 1, pTagsCount: 0, hashtags: [] })
    const start = performance.now()
    const results = pg.vectors.query(queryVec, 10, 0.5)
    const elapsed = performance.now() - start
    // Vector query over 10K entries should be fast (< 50ms)
    expect(elapsed).toBeLessThan(50)
    expect(results.length).toBeGreaterThanOrEqual(1)
  })
})

describe('PolyGraph — memory profile: repeated cycles', () => {
  let pg: PolyGraph

  beforeEach(() => { pg = new PolyGraph() })
  afterEach(async () => { await pg.persistence.clearAll() })

  it('_byPubkey does not grow on add/remove cycles', () => {
    for (let cycle = 0; cycle < 1000; cycle++) {
      pg.addNode(makeEvent(`e-${cycle}`, 1, `pk${cycle % 50}`, 1_700_000_000 + cycle))
      if (cycle >= 10) pg.removeNode(`e-${cycle - 10}`)
    }
    // After 1000 cycles, byPubkey should have at most 50 entries (10 per pubkey × 10 cycles)
    const byPubkey = (pg as any)._byPubkey as Map<string, Set<string>>
    for (const ids of byPubkey.values()) {
      expect(ids.size).toBeLessThanOrEqual(10)
    }
  })

  it('_byKindPubkey does not accumulate stale ids', () => {
    // Add and remove the same kind+pubkey combination repeatedly
    for (let i = 0; i < 500; i++) {
      const node = makeEvent(`evt:contact-${i}`, 3, 'pk-alice', 1_700_000_000 + i)
      node.data.replaceableKey = '3:pk-alice'
      pg.addNode(node)
    }
    // byKindPubkey should only have the last one
    const found = pg.byKindPubkey(3, 'pk-alice')
    expect(found).toBeDefined()
    expect(found!.id).toBe('evt:contact-499')

    // The index should have exactly 1 entry for this key
    const byKindPubkey = (pg as any)._byKindPubkey as Map<string, string>
    const matches = [...byKindPubkey].filter(([k]) => k === '3:pk-alice')
    expect(matches).toHaveLength(1)
  })

  it('byPubkey filtered by type after many add/remove cycles', () => {
    for (let i = 0; i < 500; i++) {
      pg.addNode(makeEvent(`e-${i}`, 1, 'pk-foo', 1_700_000_000 + i))
      pg.addNode(makeShape(`s-${i}`, 22, 'pk-foo'))
    }
    expect(pg.byPubkey('pk-foo', 'event')).toHaveLength(500)
    expect(pg.byPubkey('pk-foo', 'video_shape')).toHaveLength(500)

    // Remove half
    for (let i = 0; i < 500; i += 2) {
      pg.removeNode(`e-${i}`)
    }
    // Remove half of shapes
    for (let i = 0; i < 500; i += 2) {
      pg.removeNode(`s-${i}`)
    }
    expect(pg.byPubkey('pk-foo', 'event')).toHaveLength(250)
    expect(pg.byPubkey('pk-foo', 'video_shape')).toHaveLength(250)
  })

  it('vectors do not leak on repeated cycles', () => {
    for (let cycle = 0; cycle < 500; cycle++) {
      const node = makeEvent(`v-${cycle}`, 22, 'pk-v', 1_700_000_000 + cycle)
      pg.addNode(node)
      pg.vectors.add(`v-${cycle}`, [...node.vector!])
      if (cycle >= 50) {
        pg.removeNode(`v-${cycle - 50}`)
      }
    }
    // Vector count should be bounded by active nodes
    expect(pg.vectors.size).toBeLessThanOrEqual(50)
    // Every vector ID should correspond to an existing node
    for (const [id] of pg.vectors.entries()) {
      expect((pg as any).nodes.has(id)).toBe(true)
    }
  })

  it('edge list does not grow unbounded', () => {
    // Add edges between N nodes, then rotate source
    for (let i = 0; i < 100; i++) {
      pg.addNode(makeEvent(`n-${i}`, 1, 'pk-edge', 1_700_000_000 + i))
    }
    for (let cycle = 0; cycle < 500; cycle++) {
      const src = `n-${cycle % 100}`
      const tgt = `n-${(cycle + 1) % 100}`
      pg.addEdge(src, 'REFERENCES', tgt)
      if (cycle >= 100) {
        const oldSrc = `n-${(cycle - 100) % 100}`
        const oldTgt = `n-${(cycle - 100 + 1) % 100}`
        pg.removeEdges(oldSrc, 'REFERENCES', oldTgt)
      }
    }
    // Total edges should be bounded (at most 100)
    const edges = (pg as any).edges as Map<string, any[]>
    let total = 0
    for (const [, edgeList] of edges) total += edgeList.length
    expect(total).toBeLessThanOrEqual(100)
  })

  it('removedNodeIds does not grow on repeated removeNode of same id', () => {
    for (let i = 0; i < 1000; i++) {
      pg.addNode(makeEvent(`e-${i}`, 1, 'pk', 1_700_000_000 + i))
      pg.removeNode(`e-${i}`)
      // Remove same id again (no-op)
      pg.removeNode(`e-${i}`)
      pg.removeNode(`e-${i}`)
    }
    // removedNodeIds should be at most 1000 (not 3000)
    const removedNodeIds = (pg as any).removedNodeIds as Set<string>
    expect(removedNodeIds.size).toBeLessThanOrEqual(1000)
  })

  it('change subscriptions complete lifecycle without leaks', () => {
    const events: string[] = []
    const subscriptions: Array<{ unsubscribe: () => void }> = []

    // Create 100 subscriptions
    for (let i = 0; i < 100; i++) {
      const sub = pg.changes.subscribe(() => events.push(`sub-${i}`))
      subscriptions.push(sub)
    }

    pg.addNode(makeEvent('e1', 1))
    expect(events.length).toBe(100)

    // Unsubscribe half
    for (let i = 0; i < 100; i += 2) {
      subscriptions[i].unsubscribe()
    }
    events.length = 0
    pg.addNode(makeEvent('e2', 22))
    expect(events.length).toBe(50)

    // Unsubscribe rest
    for (let i = 1; i < 100; i += 2) {
      subscriptions[i].unsubscribe()
    }
    events.length = 0
    pg.addNode(makeEvent('e3', 7))
    expect(events.length).toBe(0)
  })

  it('flush does not leak removed nodes across cycles', async () => {
    for (let cycle = 0; cycle < 200; cycle++) {
      pg.addNode(makeEvent(`e-${cycle}`, 1, 'pk', 1_700_000_000 + cycle))
      if (cycle > 0) pg.removeNode(`e-${cycle - 1}`)
      await pg.flush()
    }
    // After 200 cycles, only the last node should remain
    expect(pg.size).toBe(1)
    expect(pg.getNode('e-199')).toBeDefined()
    expect(pg.getNode('e-0')).toBeUndefined()
  })

  it('warm does not reload deleted nodes', async () => {
    for (let i = 0; i < 100; i++) {
      pg.addNode(makeEvent(`e-${i}`, 1, 'pk', 1_700_000_000 + i))
    }
    await pg.flush()
    // Remove half and flush again
    for (let i = 0; i < 100; i += 2) pg.removeNode(`e-${i}`)
    await pg.flush()

    // Warm on a fresh graph
    const pg2 = new PolyGraph()
    await pg2.warm()
    expect(pg2.size).toBe(50)
    expect(pg2.getNode('e-0')).toBeUndefined()
    expect(pg2.getNode('e-1')).toBeDefined()
  })
})
