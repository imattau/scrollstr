import type { PolyNode, EdgeType, QueryOptions, NodeType } from './types'

type EdgeIndex = Map<string, Array<{ target: string; type: EdgeType; data?: Record<string, unknown> }>>

export class GraphQuery {
  private opts: QueryOptions = {}
  private nodes: Map<string, PolyNode>
  private edges: EdgeIndex
  private allTypes: Set<NodeType>

  constructor(
    nodes: Map<string, PolyNode>,
    edges: EdgeIndex,
    allTypes: Set<NodeType>
  ) {
    this.nodes = nodes
    this.edges = edges
    this.allTypes = allTypes
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

  toArray(): PolyNode[] {
    let results = this.getSourceNodes().filter(n => this.match(n))

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
}
