import { PolyGraph } from '@0xx0lostcause0xx0/polypack'
import { BinaryStoreAdapter } from '@0xx0lostcause0xx0/polypack/persistence/opfs'
import type { PersistenceAdapter } from '@0xx0lostcause0xx0/polypack'
import type { PolyNode, NodeType } from './types'

const DB_NAME = 'scrollstr-polypack'
// Shared LRU across every node type (events, profiles, reactions, zaps,
// video shapes, edges, ...). Was capped well below polypack's own default
// (50000), which caused frequent eviction of video_shape nodes under normal
// relay activity even when they were still on-screen.
const HOT_CACHE_MAX = 50000

let testPersistenceFactory: ((storeDir: string) => PersistenceAdapter) | null = null

/** Test-only hook: overrides the default persistence backend. */
export function setPersistenceFactory(factory: ((storeDir: string) => PersistenceAdapter) | null): void {
  testPersistenceFactory = factory
}

/** Production hook: allow the Tauri env to inject a custom adapter factory. */
let persistenceFactory: (() => PersistenceAdapter | Promise<PersistenceAdapter>) | null = (() =>
  Promise.resolve(new BinaryStoreAdapter({ storeDir: DB_NAME }))
)

export function setPersistenceFactoryAsync(factory: () => PersistenceAdapter | Promise<PersistenceAdapter>): void {
  persistenceFactory = factory
}

export class ScrollstrGraph extends PolyGraph {
  private _byPubkey = new Map<string, Set<string>>()
  private _byKind = new Map<number, Set<string>>()
  private _byKindPubkey = new Map<string, string>()
  private _byReplaceableKey = new Map<string, Set<string>>()

  constructor(adapter?: PersistenceAdapter) {
    super(
      adapter ?? (testPersistenceFactory
        ? testPersistenceFactory(DB_NAME)
        : new BinaryStoreAdapter({ storeDir: DB_NAME })),
      HOT_CACHE_MAX,
    )
  }

  protected override onNodeIndex(node: PolyNode): void {
    const data = node.data as Record<string, unknown>
    const kind = data.kind as number | undefined
    const pubkey = data.pubkey as string | undefined
    const id = node.id

    if (pubkey) {
      if (!this._byPubkey.has(pubkey)) this._byPubkey.set(pubkey, new Set())
      this._byPubkey.get(pubkey)!.add(id)
    }

    if (kind !== undefined) {
      if (!this._byKind.has(kind)) this._byKind.set(kind, new Set())
      this._byKind.get(kind)!.add(id)

      if (pubkey) {
        const key = `${kind}:${pubkey}`
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

  protected override onNodeUnindex(id: string, node: PolyNode): void {
    const data = node.data as Record<string, unknown>
    const kind = data.kind as number | undefined
    const pubkey = data.pubkey as string | undefined

    if (pubkey) {
      const set = this._byPubkey.get(pubkey)
      set?.delete(id)
      if (set?.size === 0) this._byPubkey.delete(pubkey)

      if (kind !== undefined) {
        const key = `${kind}:${pubkey}`
        if (this._byKindPubkey.get(key) === id) this._byKindPubkey.delete(key)
      }
    }

    if (kind !== undefined) {
      const set = this._byKind.get(kind)
      set?.delete(id)
      if (set?.size === 0) this._byKind.delete(kind)
    }

    const replaceableKey = data.replaceableKey as string | undefined
    if (replaceableKey) {
      const ids = this._byReplaceableKey.get(replaceableKey)
      ids?.delete(id)
      if (ids?.size === 0) this._byReplaceableKey.delete(replaceableKey)
    }
  }

  async putReplaceable(node: PolyNode): Promise<boolean> {
    const replaceableKey = node.data.replaceableKey as string
    if (!replaceableKey) {
      this.addNode(node)
      return true
    }

    const nodeCreatedAt = (node.data.created_at as number) ?? 0

    const existingByKeyIds = this._byReplaceableKey.get(replaceableKey)
    if (existingByKeyIds) {
      for (const existingId of existingByKeyIds) {
        if (existingId === node.id) continue
        const existing = this.nodes.get(existingId)
        if (!existing) continue
        const existingCreatedAt = (existing.data.created_at as number) ?? 0
        if (existingCreatedAt <= nodeCreatedAt) {
          this.removeNode(existing.id)
        } else {
          return false
        }
      }
    }

    const persisted = await this.persistence.queryNodes?.({ attributes: { replaceableKey } })
    if (persisted) {
      for (const old of persisted) {
        if (old.id === node.id) continue
        const oldCreatedAt = (old.data.created_at as number) ?? 0
        if (oldCreatedAt <= nodeCreatedAt) {
          await this.persistence.deleteNode(old.id)
        } else {
          return false
        }
      }
    }

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

  /** Restore persisted vectors too — the app keys vectors by event id, not node id, so the base warm's hot-cache-only hydration would drop them. */
  override async warm(): Promise<void> {
    await super.warm()
    const allVectors = await this.persistence.getAllVectors()
    for (const { id, vector } of allVectors) {
      if (!this.vectors.has(id)) this.vectors.hydrate(id, vector)
    }
  }

  byPubkey(pubkey: string, type?: NodeType): PolyNode[] {
    const ids = this._byPubkey.get(pubkey)
    if (!ids) return []
    const results: PolyNode[] = []
    for (const id of ids) {
      const node = this.nodes.get(id)
      if (node && (!type || node.type === type)) results.push(node as unknown as PolyNode)
    }
    return results
  }

  byKindPubkey(kind: number, pubkey: string): PolyNode | undefined {
    const id = this._byKindPubkey.get(`${kind}:${pubkey}`)
    if (!id) return undefined
    const node = this.nodes.get(id)
    return node as unknown as PolyNode | undefined
  }

  byKind(kind: number, type?: NodeType): PolyNode[] {
    const ids = this._byKind.get(kind)
    if (!ids) return []
    const results: PolyNode[] = []
    for (const id of ids) {
      const node = this.nodes.get(id)
      if (node && (!type || node.type === type)) results.push(node as unknown as PolyNode)
    }
    return results
  }

  byETag(targetId: string): PolyNode[] {
    const sources = this.nodeToEdgeMap.get(targetId)
    if (!sources) return []
    const results: PolyNode[] = []
    for (const src of sources) {
      const srcEdges = this.edges.get(src)
      if (srcEdges && [...srcEdges.values()].some(e => e.type === 'REFERENCES' && e.target === targetId)) {
        const node = this.nodes.get(src)
        if (node) results.push(node as unknown as PolyNode)
      }
    }
    return results
  }

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
      results.push(node as unknown as PolyNode)
    }
    return results
  }

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

  recentBy(field: 'insertOrder' | 'created_at', limit: number, type?: NodeType): PolyNode[] {
    const candidates: PolyNode[] = []
    const source = type ? this._byType.get(type) : null
    const nodes = source
      ? [...source].map(id => this.nodes.get(id)).filter(Boolean) as PolyNode[]
      : [...this.nodes.values()]
    for (const node of nodes) {
      if (type && node.type !== type) continue
      if ((node.data[field] as number | undefined) !== undefined) {
        candidates.push(node as unknown as PolyNode)
      }
    }
    return candidates
      .sort((a, b) => ((b.data[field] as number) ?? 0) - ((a.data[field] as number) ?? 0))
      .slice(0, limit)
  }
}
