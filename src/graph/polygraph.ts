import { Subject } from 'rxjs'
import type { PolyNode, PolyEdge, NodeType, EdgeType, GraphChangeEvent, SerializedNode, SerializedEdge } from './types'
import { VectorIndex, computeEventVector } from './vector-index'
import { PolyPersistence } from './persistence'
import { GraphQuery } from './query'

export { computeEventVector }

type EdgeIndex = Map<string, Array<{ target: string; type: EdgeType; data?: Record<string, unknown> }>>

function edgeId(source: string, type: EdgeType, target: string): string {
  return `${source}::${type}::${target}`
}

const HOT_CACHE_MAX = 20000

export class PolyGraph {
  private nodes = new Map<string, PolyNode>()
  private edges: EdgeIndex = new Map()
  private allTypes = new Set<NodeType>()

  readonly vectors = new VectorIndex()
  readonly persistence = new PolyPersistence()
  readonly changes = new Subject<GraphChangeEvent>()

  /** LRU hot-cache order: insertion-ordered Map used as an ordered set */
  private hotCacheOrder = new Map<string, true>()
  private nodeToEdgeMap = new Map<string, Set<string>>()

  // ── Dirty tracking for auto-persist ──

  private dirtyNodes = new Set<string>()
  private removedNodeIds = new Set<string>()
  private persistTimer: ReturnType<typeof setTimeout> | null = null

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

    // Write all edges (small, full-sync is cheap)
    const allEdges: SerializedEdge[] = []
    for (const [source, edgeList] of this.edges) {
      for (const e of edgeList) {
        allEdges.push({
          id: edgeId(source, e.type, e.target),
          source,
          target: e.target,
          type: e.type,
          data: e.data ?? null,
          createdAt: Date.now(),
        })
      }
    }
    await this.persistence.bulkPutEdges(allEdges)

    // Write all vectors (IDs may differ from node IDs)
    for (const [id, vec] of this.vectors.entries()) {
      await this.persistence.putVector(id, vec)
    }

    this.dirtyNodes.clear()
  }

  // ── Node CRUD ──

  addNode(node: PolyNode): void {
    this.nodes.set(node.id, node)
    this.allTypes.add(node.type)
    this.touchHotCache(node.id)
    this.markDirty(node.id)
    this.changes.next({ type: 'node_added', nodeId: node.id, nodeType: node.type })
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
    this.changes.next({ type: 'node_updated', nodeId: id, nodeType: node.type })
    return node
  }

  removeNode(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return

    this.cleanupNodeEdges(id)
    this.nodes.delete(id)
    this.vectors.remove(id)
    const rawId = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id
    if (rawId !== id) this.vectors.remove(rawId)

    this.dirtyNodes.delete(id)
    this.removedNodeIds.add(id)
    this.schedulePersist()
    this.hotCacheOrder.delete(id)
    this.changes.next({ type: 'node_removed', nodeId: id, nodeType: node.type })
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

    edges.push({ target, type, data })
    if (!this.nodeToEdgeMap.has(target)) this.nodeToEdgeMap.set(target, new Set())
    this.nodeToEdgeMap.get(target)!.add(source)
    this.schedulePersist()
    this.changes.next({ type: 'edge_added', edgeId: id, edgeType: type, source, target })
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
      this.changes.next({ type: 'edge_removed', edgeType: e.type, source, target: e.target })
    }
    if (this.edges.get(source)?.length === 0) this.edges.delete(source)
    if (removed.length > 0) this.schedulePersist()
  }

  // ── Query ──

  query(): GraphQuery {
    return new GraphQuery(this.nodes, this.edges, this.allTypes)
  }

  // ── Hot Cache ──

  private touchHotCache(id: string): void {
    this.hotCacheOrder.delete(id)
    this.hotCacheOrder.set(id, true)
    this.evictOldestIfOverCap()
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
      this.nodes.delete(evict)
      this.vectors.remove(evict)
      const evictRaw = evict.includes(':') ? evict.slice(evict.indexOf(':') + 1) : evict
      if (evictRaw !== evict) this.vectors.remove(evictRaw)
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
        // Register in LRU order. We deliberately do NOT call touchHotCache
        // per-node here, because mid-loop eviction would race with the
        // vector-load step below and re-add vectors for evicted nodes.
        // Eviction down to HOT_CACHE_MAX runs once after the vector load.
        this.hotCacheOrder.delete(sn.id)
        this.hotCacheOrder.set(sn.id, true)
      }
    }

    const allVectors = await this.persistence.getAllVectors()
    for (const { id, vector } of allVectors) {
      this.vectors.add(id, vector)
    }

    // Now that vectors are loaded, evict any excess nodes down to the cap.
    // Evicted nodes lose their in-memory vector via vectors.remove() (which
    // is fine — they were just added; the IDB copy remains for getNodeSafe).
    this.evictOldestIfOverCap()

    await this.rebuildEdgeIndex()

    this.changes.next({ type: 'node_added' })
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

  get size(): number {
    return this.nodes.size
  }
}

export const graph = new PolyGraph()
