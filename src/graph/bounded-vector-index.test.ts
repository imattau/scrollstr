import { describe, expect, it, vi } from 'vitest'
import { BoundedVectorIndex } from './bounded-vector-index'

describe('BoundedVectorIndex', () => {
  it('evicts the oldest entry when capacity is exceeded', () => {
    const onChange = vi.fn()
    const index = new BoundedVectorIndex(2, onChange)
    index.add('oldest', [1, 0])
    index.add('middle', [0, 1])
    index.add('newest', [1, 1])

    expect(index.size).toBe(2)
    expect(index.has('oldest')).toBe(false)
    expect(index.has('middle')).toBe(true)
    expect(index.has('newest')).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('refreshes an existing entry so active vectors survive eviction', () => {
    const index = new BoundedVectorIndex(2)
    index.hydrate('a', [1])
    index.hydrate('b', [2])
    index.hydrate('a', [3])
    index.hydrate('c', [4])

    expect(index.has('a')).toBe(true)
    expect(index.has('b')).toBe(false)
    expect(index.has('c')).toBe(true)
    expect(index.get('a')?.[0]).toBe(3)
  })

  it('hydrates without marking durable state dirty', () => {
    const onChange = vi.fn()
    const index = new BoundedVectorIndex(1, onChange)
    index.hydrate('cached', [1, 2])
    expect(onChange).not.toHaveBeenCalled()
  })
})
