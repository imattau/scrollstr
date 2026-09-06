import { VectorIndex } from '@0xx0lostcause0xx0/polypack'
import type { DistanceFunction, VectorIndexLike } from '@0xx0lostcause0xx0/polypack'

/** Exact vector index with a strict oldest-entry-first working-set bound. */
export class BoundedVectorIndex implements VectorIndexLike {
  private readonly index: VectorIndex
  private readonly order = new Map<string, true>()
  private readonly capacity: number

  constructor(
    capacity: number,
    onChange?: (id: string) => void,
    distanceFn?: DistanceFunction,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('BoundedVectorIndex capacity must be a positive integer')
    }
    this.capacity = capacity
    this.index = new VectorIndex(onChange, distanceFn)
  }

  add(id: string, vector: number[] | Float64Array): void {
    this.index.add(id, vector)
    this.refresh(id)
  }

  hydrate(id: string, vector: number[] | Float64Array): void {
    this.index.hydrate(id, vector)
    this.refresh(id)
  }

  addMany(entries: Array<{ id: string; vector: number[] | Float64Array }>): void {
    for (const entry of entries) this.add(entry.id, entry.vector)
  }

  remove(id: string): void {
    this.order.delete(id)
    this.index.remove(id)
  }

  removeMany(ids: string[]): void {
    for (const id of ids) this.order.delete(id)
    this.index.removeMany(ids)
  }

  query(vector: number[], topK: number, threshold?: number): Array<{ id: string; score: number }> {
    return this.index.query(vector, topK, threshold)
  }

  clear(): void {
    this.order.clear()
    this.index.clear()
  }

  get size(): number {
    return this.index.size
  }

  entries(): IterableIterator<[string, Float64Array]> {
    return this.index.entries()
  }

  has(id: string): boolean {
    return this.index.has(id)
  }

  get(id: string): Float64Array | undefined {
    return this.index.get(id)
  }

  private refresh(id: string): void {
    this.order.delete(id)
    this.order.set(id, true)
    while (this.order.size > this.capacity) {
      const oldest = this.order.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.order.delete(oldest)
      this.index.remove(oldest)
    }
  }
}
