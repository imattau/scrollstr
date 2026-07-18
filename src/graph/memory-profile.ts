import { graph } from './polygraph'
import type { PolyNode } from './types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface GraphMemoryState {
  timestamp: number
  nodeCount: number
  edgeCount: number
  vectorCount: number
  hotCacheSize: number
  byPubkeyEntries: number
  byKindPubkeyEntries: number
  dirtyNodes: number
  removedNodeIds: number
  subscriberCount: number
  nodeCountsByType: Record<string, number>
  edgeCountsByType: Record<string, number>
  totalEdgeListLength: number
}

export function getGraphMemoryState(): GraphMemoryState {
  const g = graph as any

  let totalEdgeListLength = 0
  const edgeCountsByType: Record<string, number> = {}
  for (const [, edgeList] of g.edges as Map<string, any[]>) {
    totalEdgeListLength += edgeList.length
    for (const e of edgeList) {
      const t = e.type as string
      edgeCountsByType[t] = (edgeCountsByType[t] ?? 0) + 1
    }
  }

  const nodeCountsByType: Record<string, number> = {}
  for (const [, node] of g.nodes as Map<string, PolyNode>) {
    const t = node.type
    nodeCountsByType[t] = (nodeCountsByType[t] ?? 0) + 1
  }

  const subscriberCount = g.changes?.observers?.length ?? 0

  return {
    timestamp: Date.now(),
    nodeCount: g.nodes.size,
    edgeCount: totalEdgeListLength,
    vectorCount: g.vectors.size,
    hotCacheSize: g.hotCacheOrder.size,
    byPubkeyEntries: [...(g._byPubkey as Map<string, Set<string>>).values()].reduce((sum, s) => sum + s.size, 0),
    byKindPubkeyEntries: (g._byKindPubkey as Map<string, string>).size,
    dirtyNodes: g.dirtyNodes.size,
    removedNodeIds: g.removedNodeIds.size,
    subscriberCount,
    nodeCountsByType,
    edgeCountsByType,
    totalEdgeListLength,
  }
}

export function printGraphMemoryState(): void {
  const s = getGraphMemoryState()
  console.group(`%c📊 Graph Memory State (${new Date(s.timestamp).toLocaleTimeString()})`, 'font-weight:bold')
  console.log(`Nodes:       ${s.nodeCount.toLocaleString()} (by type:`, s.nodeCountsByType, ')')
  console.log(`Edges:       ${s.edgeCount.toLocaleString()} (by type:`, s.edgeCountsByType, ')')
  console.log(`Vectors:     ${s.vectorCount.toLocaleString()}`)
  console.log(`Hot cache:   ${s.hotCacheSize.toLocaleString()}`)
  console.log(`byPubkey:    ${s.byPubkeyEntries.toLocaleString()} entries`)
  console.log(`byKindPubkey:${s.byKindPubkeyEntries.toLocaleString()} keys`)
  console.log(`Dirty:       ${s.dirtyNodes} nodes, ${s.removedNodeIds} removed pending flush`)
  console.log(`Subscribers: ${s.subscriberCount}`)
  console.groupEnd()
}

interface IndexConsistency {
  byPubkeyStaleIds: string[]
  byKindPubkeyStaleIds: string[]
  vectorOrphanedIds: string[]
  edgeOrphanedSourceIds: string[]
  nodeToEdgeMapStaleEntries: string[]
  hotCacheStaleIds: string[]
  totalIssues: number
}

export function checkIndexConsistency(): IndexConsistency {
  const g = graph as any
  const issues: IndexConsistency = {
    byPubkeyStaleIds: [],
    byKindPubkeyStaleIds: [],
    vectorOrphanedIds: [],
    edgeOrphanedSourceIds: [],
    nodeToEdgeMapStaleEntries: [],
    hotCacheStaleIds: [],
    totalIssues: 0,
  }

  for (const [pk, ids] of g._byPubkey as Map<string, Set<string>>) {
    for (const id of ids) {
      if (!g.nodes.has(id)) issues.byPubkeyStaleIds.push(id)
    }
  }

  for (const [key, id] of g._byKindPubkey as Map<string, string>) {
    if (!g.nodes.has(id)) issues.byKindPubkeyStaleIds.push(`${key} -> ${id}`)
  }

  for (const [id] of g.vectors.entries()) {
    if (!g.nodes.has(id) && !g.nodes.has(`evt:${id}`) && !g.nodes.has(`shp:${id}`)) {
      const colon = id.indexOf(':')
      if (colon >= 0) {
        const raw = id.slice(colon + 1)
        if (!g.nodes.has(raw)) issues.vectorOrphanedIds.push(id)
      } else {
        issues.vectorOrphanedIds.push(id)
      }
    }
  }

  for (const [src] of g.edges as Map<string, any[]>) {
    if (!g.nodes.has(src)) issues.edgeOrphanedSourceIds.push(src)
  }

  for (const [tgt, sources] of g.nodeToEdgeMap as Map<string, Set<string>>) {
    for (const src of sources) {
      const edges = g.edges.get(src)
      if (!edges || !edges.some((e: any) => e.target === tgt)) {
        issues.nodeToEdgeMapStaleEntries.push(`${tgt} <- ${src}`)
      }
    }
  }

  for (const id of (g.hotCacheOrder as Map<string, true>).keys()) {
    if (!g.nodes.has(id)) issues.hotCacheStaleIds.push(id)
  }

  issues.totalIssues =
    issues.byPubkeyStaleIds.length +
    issues.byKindPubkeyStaleIds.length +
    issues.vectorOrphanedIds.length +
    issues.edgeOrphanedSourceIds.length +
    issues.nodeToEdgeMapStaleEntries.length +
    issues.hotCacheStaleIds.length

  return issues
}

export function printIndexConsistency(): void {
  const issues = checkIndexConsistency()
  if (issues.totalIssues === 0) {
    console.log('%c✅ All indexes consistent — no stale entries found.', 'color:green;font-weight:bold')
    return
  }
  console.group(`%c⚠️ Index Inconsistencies (${issues.totalIssues} issues)`, 'color:orange;font-weight:bold')
  if (issues.byPubkeyStaleIds.length > 0) console.log(`byPubkey stale: ${issues.byPubkeyStaleIds.length} entries`)
  if (issues.byKindPubkeyStaleIds.length > 0) console.log(`byKindPubkey stale: ${issues.byKindPubkeyStaleIds.length} entries`)
  if (issues.vectorOrphanedIds.length > 0) console.log(`Orphaned vectors: ${issues.vectorOrphanedIds.length} entries`)
  if (issues.edgeOrphanedSourceIds.length > 0) console.log(`Edge sources with no node: ${issues.edgeOrphanedSourceIds.length}`)
  if (issues.nodeToEdgeMapStaleEntries.length > 0) console.log(`nodeToEdgeMap stale: ${issues.nodeToEdgeMapStaleEntries.length} entries`)
  if (issues.hotCacheStaleIds.length > 0) console.log(`hotCacheOrder stale: ${issues.hotCacheStaleIds.length} entries`)
  console.groupEnd()
}

let snapshotCounter = 0

export async function profileSnapshot(label: string): Promise<void> {
  snapshotCounter++
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`\n%c📸 [${snapshotCounter}] ${label} @ ${ts}`, 'font-size:14px;font-weight:bold')
  printGraphMemoryState()

  if (typeof performance !== 'undefined' && (performance as any).memory) {
    const mem = (performance as any).memory
    console.log(`JS heap: ${formatBytes(mem.usedJSHeapSize)} / ${formatBytes(mem.totalJSHeapSize)}`)
  }

  if (typeof globalThis !== 'undefined' && (globalThis as any).gc) {
    ;(globalThis as any).gc()
    console.log('GC triggered')
  }
}

export async function profileGraph(): Promise<void> {
  console.group('%c🔍 PolyGraph Memory Profile', 'font-size:16px;font-weight:bold')
  printGraphMemoryState()
  printIndexConsistency()
  console.groupEnd()
}
