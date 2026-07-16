import { describe, it, expect } from 'vitest'
import { isUnwatched } from './useFeedVideos'

describe('isUnwatched', () => {
  it('treats a shape with no userState as unwatched', () => {
    expect(isUnwatched({})).toBe(true)
  })

  it('treats a shape with userState but no watched flag as unwatched', () => {
    expect(isUnwatched({ userState: { liked: true } })).toBe(true)
  })

  it('treats watched: false as unwatched', () => {
    expect(isUnwatched({ userState: { watched: false } })).toBe(true)
  })

  it('treats watched: true as watched (not unwatched)', () => {
    expect(isUnwatched({ userState: { watched: true } })).toBe(false)
  })
})
