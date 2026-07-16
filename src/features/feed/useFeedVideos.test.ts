import { describe, it, expect } from 'vitest'
import { queryWindowSize } from './useFeedVideos'

describe('queryWindowSize', () => {
  it('stays at the base window for shallow scroll depths', () => {
    expect(queryWindowSize(0)).toBe(200)
    expect(queryWindowSize(50)).toBe(200)
    expect(queryWindowSize(149)).toBe(200)
  })

  it('expands once the active index plus buffer exceeds the base window', () => {
    // 150 + 50 buffer = 200, right at the edge — still the base window.
    expect(queryWindowSize(150)).toBe(200)
    // 151 + 50 = 201 → rounds up to the next 100-step.
    expect(queryWindowSize(151)).toBe(300)
  })

  it('keeps the active index inside the window with room to spare', () => {
    for (const activeIndex of [200, 350, 999, 5000]) {
      const window = queryWindowSize(activeIndex)
      expect(window).toBeGreaterThan(activeIndex)
    }
  })

  it('only grows in coarse 100-item steps, not on every scroll tick', () => {
    expect(queryWindowSize(251)).toBe(400)
    expect(queryWindowSize(299)).toBe(400)
    expect(queryWindowSize(300)).toBe(400)
    expect(queryWindowSize(351)).toBe(500)
  })
})
