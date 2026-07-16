import { Subject } from 'rxjs'
import type { PolyNode, PolyEdge, NodeType, EdgeType, GraphChangeEvent, SerializedNode, SerializedEdge } from './types'
import { EDGE_OWNERSHIP } from './types'
import type { EdgeOwnership } from './types'
import { VectorIndex, computeEventVector } from './vector-index'
import { PolyPersistence } from './persistence'
import { GraphQuery } from './query'

export { computeEventVector }

type EdgeIndex = Map<string, Array<{ target: string; type: EdgeType; data?: Record<string, unknown> }>>

function edgeId(source: string, type: EdgeType, target: string): string {
  return `${source}::${type}::${target}`
}

const HOT_CACHE_MAX = 10000

function yieldToUI(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

export class PolyGraph {
  private nodes = new Map<string, PolyNode>()
  private edges: EdgeIndex = new Map()
  private allTypes = new Set<NodeType>()

  readonly vectors: VectorIndex
  readonly persistence = new PolyPersistence()
  readonly changes = new Subject<GraphChangeEvent>()

  /** LRU hot-cache order: insertion-ordered Map used as an ordered set */
  private hotCacheOrder = new Map<string, true>()
  private nodeToEdgeMap = new Map<string, Set<string>>()

  // ── In-memory secondary indexes (maintained on addNode / removeNode / eviction) ──

  /** type → Set<nodeId> for O(1) lookups of all nodes of a given type. */
  private _byType = new Map<NodeType, Set<string>>()
  /** pubkey → Set<nodeId> for O(1) lookups of all nodes owned by a pubkey. */
  private _byPubkey = new Map<string, Set<string>>()
  /** Nostr kind → Set<nodeId> for O(1) lookups of all nodes of a given kind
   *  (unlike _byKindPubkey, keeps every matching node, not just the latest). */
  private _byKind = new Map<number, Set<string>>()
  /** Composite key `${kind}:${pubkey}` → node id. Uses most-recent-wins for
   *  replaceable events (kept current by putReplaceable); for non-replaceable
   *  events the first stored entry wins. */
  private _byKindPubkey = new Map<string, string>()
  /** replaceableKey -> in-memory node IDs for O(1) replacement lookup. */
  private _byReplaceableKey = new Map<string, Set<string>>()
  /** tag (lowercase) → Set<nodeId> for O(1) hashtag → shape lookups. */
  private byHashtag = new Map<string, Set<string>>()
  /** Target event id → Set<source event id> for #e tag lookups (maintained
   *  from REFERENCES edges rather than the node data). */
  private _byETag = new Map<string, Set<string>>()

  // ── Dirty tracking for auto-persist ──

  private dirtyNodes = new Set<string>()
  private dirtyEdges = new Set<string>()
  private dirtyVectors = new Set<string>()
  private removedEdgeIds = new Set<string>()
  private removedNodeIds = new Set<string>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private evictionSkipCounter = 0

  // ── Change-event batching ──
  // When batchDepth > 0, change events are queued instead of emitted
  // immediately. endBatch() flushes the queue. Used by bulk cache ops
  // to avoid cascading React re-renders on every single mutation.
  private batchDepth = 0
  private pendingBatchEvents: GraphChangeEvent[] = []

  /** Start buffering change events. Every startBatch() must be paired
   *  with exactly one endBatch(). Nested batching is supported. */
  startBatch(): void {
    this.batchDepth++
  }

  /** Flush buffered change events. Throws if called without a matching
   *  startBatch(). */
  endBatch(): void {
    if (this.batchDepth === 0) throw new Error('endBatch without startBatch')
    this.batchDepth--
    if (this.batchDepth > 0) return
    const events = this.pendingBatchEvents
    this.pendingBatchEvents = []
    for (const ev of events) {
      this.changes.next(ev)
    }
  }

  private emitChange(event: GraphChangeEvent): void {
    if (this.batchDepth > 0) {
      this.pendingBatchEvents.push(event)
    } else {
      this.changes.next(event)
    }
  }

  constructor() {
    this.vectors = new VectorIndex((id) => {
      this.dirtyVectors.add(id)
      this.schedulePersist()
    })
  }

  private markDirty(id: string): void {
    if (!this.removedNodeIds.has(id)) this.dirtyNodes.add(id)
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.flush().catch((err) => console.warn('[PolyGraph] Flush error:', err))
    }, 2000)
  }

  async flush(): Promise<void> {
    const nodesToSave: SerializedNode[] = []
    for (const id of this.dirtyNodes) {
      const node = this.nodes.get(id)
      if (node) {
        nodesToSave.push({
          id: node.id,
          type: node.type,
          data: node.data,
          vector: node.vector ? [...node.vector] : null,
          insertedAt: node.insertedAt,
          updatedAt: node.updatedAt,
          // The replaceable key lives in node.data.replaceableKey when the
          // event is a replaceable kind; it is copied here so the IDB index
          // can be queried by putReplaceable.
          replaceableKey: (node.data.replaceableKey as string) ?? undefined,
        })
      }
    }

    if (this.removedNodeIds.size > 0) {
      const removed = [...this.removedNodeIds]
      await this.persistence.bulkDeleteNodes(removed)
      for (const id of removed) {
        await this.persistence.deleteVector(id)
      }
      this.removedNodeIds.clear()
    }

    if (nodesToSave.length > 0) {
      await this.persistence.bulkPutNodes(nodesToSave)
    }

    // Write only dirty edges (previously wrote all edges every 2s)
    const dirtyEdgeList: SerializedEdge[] = []
    for (const edgeIdStr of this.dirtyEdges) {
      const parts = edgeIdStr.split('::')
      if (parts.length < 3) continue
      const [source, type, ...rest] = parts
      const target = rest.join('::')
      const edges = this.edges.get(source)
      const edge = edges?.find(e => e.type === type && e.target === target)
      if (edge) {
        dirtyEdgeList.push({
          id: edgeIdStr,
          source,
          target: edge.target,
          type: edge.type,
          data: edge.data ?? null,
          createdAt: Date.now(),
        })
      }
    }
    await this.persistence.bulkPutEdges(dirtyEdgeList)
    this.dirtyEdges.clear()

    if (this.removedEdgeIds.size > 0) {
      const removedEdges = [...this.removedEdgeIds]
      await this.persistence.bulkDeleteEdges(removedEdges)
      this.removedEdgeIds.clear()
    }

    // Write only changed vectors (IDs may differ from node IDs) in one
    // transaction to avoid one IndexedDB transaction per vector.
    const dirtyVectorEntries: Array<{ id: string; vector: number[] }> = []
    for (const id of this.dirtyVectors) {
      const vector = this.vectors.get(id)
      if (vector) dirtyVectorEntries.push({ id, vector })
    }
    await this.persistence.bulkPutVectors(dirtyVectorEntries)

    this.dirtyNodes.clear()
    this.dirtyVectors.clear()
  }

  // ── Node CRUD ──

  addNode(node: PolyNode): void {
    this.nodes.set(node.id, node)
    this.allTypes.add(node.type)
    this.touchHotCache(node.id)
    this.markDirty(node.id)
    this.indexNode(node)
    this.emitChange({ type: 'node_added', nodeId: node.id, nodeType: node.type })
  }

  private indexNode(node: PolyNode): void {
    const data = node.data as Record<string, unknown>
    const kind = data.kind as number | undefined
    const pubkey = data.pubkey as string | undefined
    const id = node.id

    if (!this._byType.has(node.type)) this._byType.set(node.type, new Set())
    this._byType.get(node.type)!.add(id)

    if (kind !== undefined) {
      if (!this._byKind.has(kind)) this._byKind.set(kind, new Set())
      this._byKind.get(kind)!.add(id)
    }

    if (pubkey) {
      if (!this._byPubkey.has(pubkey)) this._byPubkey.set(pubkey, new Set())
      this._byPubkey.get(pubkey)!.add(id)
      if (kind !== undefined) {
        const key = `${kind}:${pubkey}`
        // For replaceable events, use most-recent-wins; for others the first
        // stored entry wins. Compare by data.created_at when overwriting.
        const existingId = this._byKindPubkey.get(key)
        if (!existingId || ((data.created_at as number) ?? 0) > ((this.nodes.get(existingId)?.data.created_at as number) ?? 0)) {
          this._byKindPubkey.set(key, id)
        }
      }
    }

    const replaceableKey = data.replaceableKey as string | undefined
    if (replaceableKey) {
      if (!this._byReplaceableKey.has(replaceableKey)) this._byReplaceableKey.set(replaceableKey, new Set())
      this._byReplaceableKey.get(replaceableKey)!.add(id)
    }
  }

  private unindexNode(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return
    const data = node.data as Record<string, unknown>
    const kind = data.kind as number | undefined
    const pubkey = data.pubkey as string | undefined

    const typeSet = this._byType.get(node.type)
    if (typeSet) {
      typeSet.delete(id)
      if (typeSet.size === 0) this._byType.delete(node.type)
    }

    if (kind !== undefined) {
      const kindSet = this._byKind.get(kind)
      if (kindSet) {
        kindSet.delete(id)
        if (kindSet.size === 0) this._byKind.delete(kind)
      }
    }

    if (pubkey) {
      const set = this._byPubkey.get(pubkey)
      if (set) {
        set.delete(id)
        if (set.size === 0) this._byPubkey.delete(pubkey)
      }
      if (kind !== undefined) {
        const key = `${kind}:${pubkey}`
        if (this._byKindPubkey.get(key) === id) this._byKindPubkey.delete(key)
      }
    }

    const replaceableKey = data.replaceableKey as string | undefined
    if (replaceableKey) {
      const ids = this._byReplaceableKey.get(replaceableKey)
      ids?.delete(id)
      if (ids?.size === 0) this._byReplaceableKey.delete(replaceableKey)
    }
  }

  /**
   * Add or replace a replaceable Nostr event node (kinds 0, 3, 10002, and
   * NIP-33 addressable range). Compares `data.created_at` with any existing
   * in-memory or persisted node that shares the same `replaceableKey`
   * (`${kind}:${pubkey}[:${dTag}]`). If an older version is found it is
   * removed; if the existing is newer the insert is skipped.
   */
  async putReplaceable(node: PolyNode): Promise<boolean> {
    const replaceableKey = node.data.replaceableKey as string
    if (!replaceableKey) {
      this.addNode(node)
      return true
    }

    // 1. Check in-memory hot cache for an older version with the same key.
    const nodeCreatedAt = (node.data.created_at as number) ?? 0
    const existingByKey = [...(this._byReplaceableKey.get(replaceableKey) ?? [])]
      .map(id => this.nodes.get(id))
      .filter((n): n is PolyNode => !!n)
    for (const existing of existingByKey) {
      if (existing.id === node.id) continue
      const existingCreatedAt = (existing.data.created_at as number) ?? 0
      if (existingCreatedAt <= nodeCreatedAt) {
        // New event supersedes or matches old — remove stale in-memory node.
        this.removeNode(existing.id)
      } else {
        // Stored version is newer — skip inserting this one.
        return false
      }
    }

    // 2. Check IDB for older versions (may have been evicted from hot cache).
    const persisted = await this.persistence.getNodesByReplaceableKey(replaceableKey)
    for (const old of persisted) {
      if (old.id === node.id) continue
      const oldCreatedAt = (old.data.created_at as number) ?? 0
      if (oldCreatedAt <= nodeCreatedAt) {
        // Stale row in IDB — queue for deletion and flush will clean it up.
        await this.persistence.deleteNode(old.id)
      } else {
        return false
      }
    }

    // 3. Insert or replace the in-memory node.
    const existing = this.nodes.get(node.id)
    if (existing) {
      Object.assign(existing.data, node.data)
      existing.updatedAt = node.updatedAt
      existing.vector = node.vector
      if (node.vector) this.markVectorDirty(node.id)
      this.touchHotCache(node.id)
      this.markDirty(node.id)
      this.emitChange({ type: 'node_updated', nodeId: node.id, nodeType: node.type })
    } else {
      this.addNode(node)
    }
    return true
  }

  getNode(id: string): PolyNode | undefined {
    const node = this.nodes.get(id)
    if (node) {
      this.touchHotCache(id)
      return node
    }
    // Try to load from persistence (handles hot-cache eviction)
    return undefined
  }

  /** getNode with fallback to IndexedDB persistence for evicted nodes */
  async getNodeSafe(id: string): Promise<PolyNode | undefined> {
    const node = this.nodes.get(id)
    if (node) {
      this.touchHotCache(id)
      return node
    }
    const serialized = await this.persistence.getNode(id)
    if (!serialized) return undefined
    const restored: PolyNode = {
      id: serialized.id,
      type: serialized.type,
      data: serialized.data,
      vector: serialized.vector ? new Float64Array(serialized.vector) : undefined,
      insertedAt: serialized.insertedAt,
      updatedAt: serialized.updatedAt,
    }
    this.nodes.set(id, restored)
    this.allTypes.add(restored.type)
    this.touchHotCache(id)
    return restored
  }

  updateNode(id: string, data: Partial<Record<string, unknown>>): PolyNode | undefined {
    const node = this.nodes.get(id)
    if (!node) return undefined
    Object.assign(node.data, data)
    node.updatedAt = Date.now()
    this.touchHotCache(id)
    this.markDirty(id)
    this.emitChange({ type: 'node_updated', nodeId: id, nodeType: node.type })
    return node
  }

  removeNode(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return

    this.cleanupNodeEdges(id)
    this.unindexNode(id)
    this.nodes.delete(id)
    this.vectors.remove(id)
    this.dirtyVectors.delete(id)
    const rawId = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
    if (rawId !== id) {
      this.vectors.remove(rawId)
      this.dirtyVectors.delete(rawId)
    }

    this.dirtyNodes.delete(id)
    this.removedNodeIds.add(id)
    this.schedulePersist()
    this.hotCacheOrder.delete(id)
    this.emitChange({ type: 'node_removed', nodeId: id, nodeType: node.type })
  }

  private cleanupNodeEdges(id: string): void {
    const rawId = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
    const idsToCheck = id === rawId ? [id] : [id, rawId]

    for (const lookupId of idsToCheck) {
      const sourceEdges = this.edges.get(lookupId)
      if (sourceEdges) {
        for (const e of sourceEdges) {
          this.nodeToEdgeMap.get(e.target)?.delete(lookupId)
        }
        this.edges.delete(lookupId)
      }
      this.nodeToEdgeMap.delete(lookupId)
    }
  }

  // ── Edge CRUD ──

  addEdge(source: string, type: EdgeType, target: string, data?: Record<string, unknown>): void {
    const id = edgeId(source, type, target)
    if (!this.edges.has(source)) this.edges.set(source, [])
    const edges = this.edges.get(source)!
    const existing = edges.find(e => e.type === type && e.target === target)
    if (existing) return

    // Tag the edge with its default ownership class unless the caller
    // overrides via data.__ownership.
    const fullData = { ...data, __ownership: data?.__ownership ?? EDGE_OWNERSHIP[type] }

    edges.push({ target, type, data: fullData })
    if (!this.nodeToEdgeMap.has(target)) this.nodeToEdgeMap.set(target, new Set())
    this.nodeToEdgeMap.get(target)!.add(source)
    this.dirtyEdges.add(id)
    this.schedulePersist()
    this.emitChange({ type: 'edge_added', edgeId: id, edgeType: type, source, target })
  }

  /** Mark a vector added through the public VectorIndex as needing persistence. */
  markVectorDirty(id: string): void {
    if (this.vectors.has(id)) this.dirtyVectors.add(id)
    this.schedulePersist()
  }

  getEdges(source: string, type?: EdgeType): Array<{ target: string; type: EdgeType; data?: Record<string, unknown> }> {
    const edges = this.edges.get(source)
    if (!edges) return []
    if (type) return edges.filter(e => e.type === type)
    return [...edges]
  }

  getEdgeTargets(source: string, type: EdgeType): string[] {
    const edges = this.edges.get(source)
    if (!edges) return []
    return edges.filter(e => e.type === type).map(e => e.target)
  }

  getEdgeSources(target: string, type: EdgeType): string[] {
    const sources = this.nodeToEdgeMap.get(target)
    if (!sources) return []
    return [...sources].filter(source => {
      const edges = this.edges.get(source)
      return edges?.some(e => e.type === type && e.target === target)
    })
  }

  removeEdges(source: string, type?: EdgeType, target?: string): void {
    const edges = this.edges.get(source)
    if (!edges) return
    const removed = edges.filter(e => (!type || e.type === type) && (!target || e.target === target))
    this.edges.set(
      source,
      edges.filter(e => !removed.includes(e))
    )
    for (const e of removed) {
      this.nodeToEdgeMap.get(e.target)?.delete(source)
      this.dirtyEdges.delete(edgeId(source, e.type, e.target))
      this.removedEdgeIds.add(edgeId(source, e.type, e.target))
      this.emitChange({ type: 'edge_removed', edgeType: e.type, source, target: e.target })
    }
    if (this.edges.get(source)?.length === 0) this.edges.delete(source)
    if (removed.length > 0) this.schedulePersist()
  }

  // ── Query ──

  query(): GraphQuery {
    return new GraphQuery(this.nodes, this.edges, this.allTypes, this.nodeToEdgeMap)
  }

  // ── Hot Cache ──

  private touchHotCache(id: string): void {
    this.hotCacheOrder.delete(id)
    this.hotCacheOrder.set(id, true)
    // Check eviction only every 10 touches to avoid the while-loop
    // overhead on every single graph mutation during bulk operations.
    if (++this.evictionSkipCounter % 10 === 0) {
      this.evictOldestIfOverCap()
    }
  }

  /** Evict the least-recently-touched nodes from RAM until the hot cache is
   *  at or below HOT_CACHE_MAX. Evicted nodes are NOT removed from
   *  IndexedDB — they remain durable and can be restored via getNodeSafe(). */
  private evictOldestIfOverCap(): void {
    while (this.hotCacheOrder.size > HOT_CACHE_MAX) {
      const evict = this.hotCacheOrder.keys().next().value
      if (evict === undefined) break
      this.hotCacheOrder.delete(evict)
      this.cleanupNodeEdges(evict)
      this.unindexNode(evict)
      this.nodes.delete(evict)
      this.vectors.remove(evict)
      this.dirtyVectors.delete(evict)
      const evictRaw = evict.includes(':') ? evict.slice(evict.indexOf(':') + 1) : evict
      if (evictRaw !== evict) this.vectors.remove(evictRaw)
      if (evictRaw !== evict) this.dirtyVectors.delete(evictRaw)
    }
  }

  // ── Persistence ──

  async persistNode(node: PolyNode): Promise<void> {
    const serialized: SerializedNode = {
      id: node.id,
      type: node.type,
      data: node.data,
      vector: node.vector ? [...node.vector] : null,
      insertedAt: node.insertedAt,
      updatedAt: node.updatedAt,
      replaceableKey: (node.data.replaceableKey as string) ?? undefined,
    }
    await this.persistence.putNode(serialized)
  }

  async persistEdge(source: string, type: EdgeType, target: string, data?: Record<string, unknown>): Promise<void> {
    const serialized: SerializedEdge = {
      id: edgeId(source, type, target),
      source,
      target,
      type,
      data: data ?? null,
      createdAt: Date.now(),
    }
    await this.persistence.putEdge(serialized)
  }

  async persistVector(id: string): Promise<void> {
    const vec = this.vectors.get(id)
    if (vec) await this.persistence.putVector(id, vec)
  }

  async save(): Promise<void> {
    const nodes: SerializedNode[] = []
    const edges: SerializedEdge[] = []
    const vectors: Array<{ id: string; vector: number[] }> = []

    for (const node of this.nodes.values()) {
      nodes.push({
        id: node.id,
        type: node.type,
        data: node.data,
        vector: node.vector ? [...node.vector] : null,
        insertedAt: node.insertedAt,
        updatedAt: node.updatedAt,
        replaceableKey: (node.data.replaceableKey as string) ?? undefined,
      })
    }

    for (const [source, edgeList] of this.edges) {
      for (const e of edgeList) {
        edges.push({
          id: edgeId(source, e.type, e.target),
          source,
          target: e.target,
          type: e.type,
          data: e.data ?? null,
          createdAt: Date.now(),
        })
      }
    }

    for (const [id, vector] of this.vectors.entries()) {
      vectors.push({ id, vector })
    }

    await Promise.all([
      this.persistence.bulkPutNodes(nodes),
      this.persistence.bulkPutEdges(edges),
      this.persistence.bulkPutVectors(vectors),
    ])
  }

  async load(): Promise<void> {
    await this.warm()
  }

  private async rebuildEdgeIndex(): Promise<void> {
    this.edges.clear()
    this.nodeToEdgeMap.clear()
    const allEdges = await this.persistence.getAllEdges()
    for (const e of allEdges) {
      if (!this.edges.has(e.source)) this.edges.set(e.source, [])
      this.edges.get(e.source)!.push({ target: e.target, type: e.type, data: e.data ?? undefined })
      if (!this.nodeToEdgeMap.has(e.target)) this.nodeToEdgeMap.set(e.target, new Set())
      this.nodeToEdgeMap.get(e.target)!.add(e.source)
    }
  }

  async warm(): Promise<void> {
    const allNodeIds = await this.persistence.allNodeIds()
    if (allNodeIds.length === 0) return

    const serialized = await this.persistence.getNodes(allNodeIds)
    for (const sn of serialized) {
      if (!this.nodes.has(sn.id)) {
        this.nodes.set(sn.id, {
          id: sn.id,
          type: sn.type,
          data: sn.data,
          vector: sn.vector ? new Float64Array(sn.vector) : undefined,
          insertedAt: sn.insertedAt,
          updatedAt: sn.updatedAt,
        })
        this.allTypes.add(sn.type)
        this.indexNode(this.nodes.get(sn.id)!)
        // Register in LRU order. We deliberately do NOT call touchHotCache
        // per-node here, because mid-loop eviction would race with the
        // vector-load step below and re-add vectors for evicted nodes.
        // Eviction down to HOT_CACHE_MAX runs once after the vector load.
        this.hotCacheOrder.delete(sn.id)
        this.hotCacheOrder.set(sn.id, true)
      }
    }

    await yieldToUI()

    const allVectors = await this.persistence.getAllVectors()
    for (const { id, vector } of allVectors) {
      this.vectors.add(id, vector)
    }

    await yieldToUI()

    // Now that vectors are loaded, evict any excess nodes down to the cap.
    // Evicted nodes lose their in-memory vector via vectors.remove() (which
    // is fine — they were just added; the IDB copy remains for getNodeSafe).
    this.evictOldestIfOverCap()

    await this.rebuildEdgeIndex()

    // Emit per-type change events so useGraphQuery nodeTypes filters work
    // properly during warm-up instead of a single generic event.
    for (const nodeType of this.allTypes) {
      this.emitChange({ type: 'node_added', nodeType })
    }
  }

  // ── Pruning ──

  async prune(maxNodes: number): Promise<void> {
    if (this.nodes.size <= maxNodes) return
    const excess = [...this.nodes.entries()]
      .sort(([, a], [, b]) => a.insertedAt - b.insertedAt)
      .slice(0, this.nodes.size - maxNodes)

    for (const [id] of excess) {
      this.removeNode(id)
    }
  }

  // ── Clear ──

  clear(): void {
    this.nodes.clear()
    this.edges.clear()
    this.allTypes.clear()
    this.vectors.clear()
    this.hotCacheOrder.clear()
    this.nodeToEdgeMap.clear()
    this._byType.clear()
    this._byKind.clear()
    this._byPubkey.clear()
    this._byKindPubkey.clear()
    this._byReplaceableKey.clear()
    this.byHashtag.clear()
    this._byETag.clear()
    this.dirtyEdges.clear()
    this.dirtyVectors.clear()
    this.dirtyNodes.clear()
    this.removedNodeIds.clear()
    this.removedEdgeIds.clear()
  }

  /** Tear down long-lived resources: close the IndexedDB connection and
   *  clear in-memory state. The singleton `graph` remains reusable after
   *  this — re-`warm()` will re-open the DB. Call on logout. */
  async dispose(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.clear()
    await this.persistence.close()
  }

  // ── Public Query API ────────────────────────────────────────────

  /** Return all nodes of the given type (O(1) via _byType index). */
  whereType(type: NodeType): PolyNode[] {
    const ids = this._byType.get(type)
    if (!ids) return []
    const results: PolyNode[] = []
    for (const id of ids) {
      const node = this.nodes.get(id)
      if (node) results.push(node)
    }
    return results
  }

  /** Return all nodes whose data field is in the given range. Uses _byType
   *  index when `type` is provided (O(n) over the type subset), otherwise
   *  scans all nodes. */
  whereFieldRange(field: string, range: { above?: number; below?: number }, type?: NodeType): PolyNode[] {
    const results: PolyNode[] = []
    const candidates = type ? this._byType.get(type) : null
    const source = candidates
      ? [...candidates].map(id => this.nodes.get(id)).filter(Boolean) as PolyNode[]
      : [...this.nodes.values()]
    for (const node of source) {
      if (type && node.type !== type) continue
      const val = (node.data as Record<string, unknown>)[field] as number | undefined
      if (val === undefined) continue
      if (range.above !== undefined && val <= range.above) continue
      if (range.below !== undefined && val >= range.below) continue
      results.push(node)
    }
    return results
  }

  /** Count nodes matching a field range, optionally filtered by type (uses
   *  _byType index when type is provided). */
  countByFieldRange(field: string, range: { above?: number; below?: number }, type?: NodeType): number {
    let count = 0
    const candidates = type ? this._byType.get(type) : null
    const source = candidates
      ? [...candidates].map(id => this.nodes.get(id)).filter(Boolean) as PolyNode[]
      : [...this.nodes.values()]
    for (const node of source) {
      if (type && node.type !== type) continue
      const val = (node.data as Record<string, unknown>)[field] as number | undefined
      if (val === undefined) continue
      if (range.above !== undefined && val <= range.above) continue
      if (range.below !== undefined && val >= range.below) continue
      count++
    }
    return count
  }

  /** Return the N most-recently-inserted nodes, optionally filtered by type
   *  (uses _byType index when type is provided). */
  recentBy(field: 'insertOrder' | 'created_at', limit: number, type?: NodeType): PolyNode[] {
    const candidates: PolyNode[] = []
    const source = type ? this._byType.get(type) : null
    const nodes = source
      ? [...source].map(id => this.nodes.get(id)).filter(Boolean) as PolyNode[]
      : [...this.nodes.values()]
    for (const node of nodes) {
      if (type && node.type !== type) continue
      if ((node.data[field] as number | undefined) !== undefined) {
        candidates.push(node)
      }
    }
    return candidates
      .sort((a, b) => ((b.data[field] as number) ?? 0) - ((a.data[field] as number) ?? 0))
      .slice(0, limit)
  }

  /** Index-backed: O(1) lookup of all nodes by pubkey, optionally filtered by type. */
  byPubkey(pubkey: string, type?: NodeType): PolyNode[] {
    const ids = this._byPubkey.get(pubkey)
    if (!ids) return []
    const results: PolyNode[] = []
    for (const id of ids) {
      const node = this.nodes.get(id)
      if (node && (!type || node.type === type)) results.push(node)
    }
    return results
  }

  /** Index-backed: O(1) lookup of a single node by (kind, pubkey) composite key. */
  byKindPubkey(kind: number, pubkey: string): PolyNode | undefined {
    const id = this._byKindPubkey.get(`${kind}:${pubkey}`)
    if (!id) return undefined
    return this.nodes.get(id)
  }

  /** Index-backed: O(1) lookup of all nodes by Nostr kind, optionally filtered
   *  by node type. Returns every matching node (not just the latest) — use
   *  this instead of whereType(type).filter(kind === ...) for kind lookups. */
  byKind(kind: number, type?: NodeType): PolyNode[] {
    const ids = this._byKind.get(kind)
    if (!ids) return []
    const results: PolyNode[] = []
    for (const id of ids) {
      const node = this.nodes.get(id)
      if (node && (!type || node.type === type)) results.push(node)
    }
    return results
  }

  /** Edge-derived: O(degree) lookup of all source event IDs that have a
   *  REFERENCES edge targeting `eventId`. Built on nodeToEdgeMap. */
  byETag(targetId: string): PolyNode[] {
    const sources = this.nodeToEdgeMap.get(targetId)
    if (!sources) return []
    const results: PolyNode[] = []
    for (const src of sources) {
      // Verify the edge is REFERENCES (nodeToEdgeMap key is raw target;
      // src is raw source; check via edges map).
      const srcEdges = this.edges.get(src)
      if (srcEdges && srcEdges.some(e => e.type === 'REFERENCES' && e.target === targetId)) {
        const node = this.nodes.get(src)
        if (node) results.push(node)
      }
    }
    return results
  }

  get size(): number {
    return this.nodes.size
  }
}

export const graph = new PolyGraph()
