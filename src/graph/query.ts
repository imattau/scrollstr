import type { PolyNode, EdgeType, QueryOptions, NodeType } from './types'

type EdgeIndex = Map<string, Array<{ target: string; type: EdgeType; data?: Record<string, unknown> }>>

interface TraversalStep {
  edgeType: EdgeType
  depth: number
  direction: 'out' | 'in'
}

export class GraphQuery {
  private opts: QueryOptions & { afterSteps?: TraversalStep[] } = {}
  private nodes: Map<string, PolyNode>
  private edges: EdgeIndex
  private nodeToEdgeMap: Map<string, Set<string>>
  private allTypes: Set<NodeType>

  constructor(
    nodes: Map<string, PolyNode>,
    edges: EdgeIndex,
    allTypes: Set<NodeType>,
    nodeToEdgeMap: Map<string, Set<string>>,
  ) {
    this.nodes = nodes
    this.edges = edges
    this.allTypes = allTypes
    this.nodeToEdgeMap = nodeToEdgeMap
  }

  where(field: string, value: unknown): this {
    if (field === 'kind' || field === 'pubkey' || field === 'type') {
      const attrs = this.opts.attributes ?? {}
      attrs[field] = value
      this.opts.attributes = attrs
    }
    return this
  }

  whereAttribute(name: string, value: unknown): this {
    const attrs = this.opts.attributes ?? {}
    attrs[name] = value
    this.opts.attributes = attrs
    return this
  }

  whereAttributeRange(name: string, range: { above?: number; below?: number }): this {
    const ranges = this.opts.attributeRanges ?? {}
    ranges[name] = range
    this.opts.attributeRanges = ranges
    return this
  }

  whereNodeType(...types: NodeType[]): this {
    this.opts.nodeTypes = types
    return this
  }

  whereEdge(type: EdgeType, target?: string): this {
    this.opts.edgeType = type
    if (target) this.opts.edgeTarget = target
    return this
  }

  whereEdgeSource(source: string): this {
    this.opts.edgeSource = source
    return this
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.opts.orderBy = { field, direction }
    return this
  }

  limit(n: number): this {
    this.opts.limit = n
    return this
  }

  offset(n: number): this {
    this.opts.offset = n
    return this
  }

  /** Multi-hop BFS along `edgeType` edges, replacing the current candidate
   *  set with every ID reachable within `depth` hops. Out-edges = traversal
   *  from node to its targets; in-edges = traversal from node to its sources. */
  traverse(edgeType: EdgeType, depth: number, direction: 'out' | 'in' = 'out'): this {
    const steps = this.opts.afterSteps ?? []
    steps.push({ edgeType, depth, direction })
    this.opts.afterSteps = steps
    return this
  }

  private match(node: PolyNode): boolean {
    if (this.opts.nodeTypes && !this.opts.nodeTypes.includes(node.type)) return false

    if (this.opts.attributes) {
      for (const [key, val] of Object.entries(this.opts.attributes)) {
        const nodeVal = (node.data as Record<string, unknown>)[key]
        if (key === 'type' && node.type !== val) return false
        if (key !== 'type' && nodeVal !== val) return false
      }
    }

    if (this.opts.attributeRanges) {
      for (const [key, range] of Object.entries(this.opts.attributeRanges)) {
        const val = (node.data as Record<string, unknown>)[key] as number | undefined
        if (val === undefined) return false
        if (range.above !== undefined && val <= range.above) return false
        if (range.below !== undefined && val >= range.below) return false
      }
    }

    if (this.opts.edgeType) {
      const nodeEdges = this.edges.get(node.id)
      if (!nodeEdges) return false
      const matched = nodeEdges.some(
        e =>
          e.type === this.opts.edgeType &&
          (!this.opts.edgeTarget || e.target === this.opts.edgeTarget)
      )
      if (!matched) return false
    }

    if (this.opts.edgeSource) {
      const nodeEdges = this.edges.get(this.opts.edgeSource)
      if (!nodeEdges || !nodeEdges.some(e => e.target === node.id && (!this.opts.edgeType || e.type === this.opts.edgeType))) {
        return false
      }
    }

    return true
  }

  private getSourceNodes(): PolyNode[] {
    const ids = new Set<string>()

    if (this.opts.edgeSource && this.opts.edgeType) {
      const sourceEdges = this.edges.get(this.opts.edgeSource)
      if (sourceEdges) {
        for (const e of sourceEdges) {
          if (e.type === this.opts.edgeType) ids.add(e.target)
        }
      }
    } else if (this.opts.edgeTarget && this.opts.edgeType) {
      for (const [nodeId, nodeEdges] of this.edges) {
        for (const e of nodeEdges) {
          if (e.type === this.opts.edgeType && e.target === this.opts.edgeTarget) {
            ids.add(nodeId)
          }
        }
      }
    }

    if (ids.size > 0) {
      return [...ids].map(id => this.nodes.get(id)).filter((n): n is PolyNode => !!n)
    }

    const allNodes = [...this.nodes.values()]
    if (this.opts.nodeTypes) return allNodes.filter(n => this.opts.nodeTypes!.includes(n.type))
    if (this.opts.edgeType) return allNodes
    return allNodes
  }

  /** Internal: BFS traversal on a set of ID strings. Returns all reachable
   *  IDs within `depth` hops along edges matching `step`. */
  private bfs(seeds: string[], step: TraversalStep): Set<string> {
    const visited = new Set<string>(seeds)
    let frontier = [...seeds]
    for (let d = 0; d < step.depth; d++) {
      if (frontier.length === 0) break
      const next: string[] = []
      for (const id of frontier) {
        if (step.direction === 'out') {
          const outEdges = this.edges.get(id)
          if (outEdges) {
            for (const e of outEdges) {
              if (e.type === step.edgeType && !visited.has(e.target)) {
                visited.add(e.target)
                next.push(e.target)
              }
            }
          }
        } else {
          const sources = this.nodeToEdgeMap.get(id)
          if (sources) {
            for (const src of sources) {
              if (visited.has(src)) continue
              // Verify the reverse edge has the matching type.
              const srcEdges = this.edges.get(src)
              if (srcEdges) {
                for (const e of srcEdges) {
                  if (e.type === step.edgeType && e.target === id && !visited.has(src)) {
                    visited.add(src)
                    next.push(src)
                    break
                  }
                }
              }
            }
          }
        }
      }
      frontier = next
    }
    return visited
  }

  /** Apply any stored traversal steps to a candidate ID set, returning the
   *  expanded set. */
  private applyTraversals(ids: string[]): Set<string> {
    if (!this.opts.afterSteps || this.opts.afterSteps.length === 0) return new Set(ids)
    let current = new Set(ids)
    for (const step of this.opts.afterSteps) {
      current = this.bfs([...current], step)
    }
    return current
  }

  /** Resolve a set of ID strings to their PolyNode objects (missing nodes
   *  are silently dropped). */
  private resolve(ids: Set<string>): PolyNode[] {
    const result: PolyNode[] = []
    for (const id of ids) {
      const node = this.nodes.get(id)
      if (node) result.push(node)
    }
    return result
  }

  toArray(): PolyNode[] {
    let results = this.getSourceNodes().filter(n => this.match(n))
    if (results.length === 0) return []

    // Apply multi-hop traversal
    if (this.opts.afterSteps && this.opts.afterSteps.length > 0) {
      const ids = results.map(n => n.id)
      const expanded = this.applyTraversals(ids)
      results = this.resolve(expanded)
    }

    if (this.opts.orderBy) {
      const { field, direction } = this.opts.orderBy
      results = [...results].sort((a, b) => {
        const av = (a.data as Record<string, unknown>)[field] as number ?? 0
        const bv = (b.data as Record<string, unknown>)[field] as number ?? 0
        return direction === 'asc' ? av - bv : bv - av
      })
    }

    if (this.opts.offset) results = results.slice(this.opts.offset)
    if (this.opts.limit) results = results.slice(0, this.opts.limit)

    return results
  }

  first(): PolyNode | null {
    return this.toArray()[0] ?? null
  }

  count(): number {
    if (this.opts.afterSteps && this.opts.afterSteps.length > 0) {
      return this.toArray().length
    }
    return this.getSourceNodes().filter(n => this.match(n)).length
  }

  ids(): string[] {
    return this.toArray().map(n => n.id)
  }

  uniqueKeys(field: string): unknown[] {
    const keys = new Set<unknown>()
    for (const node of this.nodes.values()) {
      const val = (node.data as Record<string, unknown>)[field]
      if (val !== undefined) keys.add(val)
    }
    return [...keys]
  }

  /** Terminal: collect all nodes reachable from the current result set via
   *  one hop of `edgeType`, optionally filtered by `predicate`. Does NOT
   *  replace the current candidate set — returns a separate array. */
  collect(edgeType: EdgeType, direction: 'out' | 'in' = 'out', predicate?: (node: PolyNode) => boolean): PolyNode[] {
    const seeds = this.toArray()
    const collected: PolyNode[] = []
    const seen = new Set<string>()

    for (const seed of seeds) {
      if (direction === 'out') {
        const outEdges = this.edges.get(seed.id)
        if (outEdges) {
          for (const e of outEdges) {
            if (e.type !== edgeType) continue
            if (seen.has(e.target)) continue
            seen.add(e.target)
            const node = this.nodes.get(e.target)
            if (node && (!predicate || predicate(node))) {
              collected.push(node)
            }
          }
        }
      } else {
        const sources = this.nodeToEdgeMap.get(seed.id)
        if (sources) {
          for (const src of sources) {
            if (seen.has(src)) continue
            // Verify edge type
            const srcEdges = this.edges.get(src)
            if (!srcEdges) continue
            const matched = srcEdges.some(e => e.type === edgeType && e.target === seed.id)
            if (!matched) continue
            seen.add(src)
            const node = this.nodes.get(src)
            if (node && (!predicate || predicate(node))) {
              collected.push(node)
            }
          }
        }
      }
    }

    return collected
  }
}
