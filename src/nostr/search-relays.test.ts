import { describe, it, expect } from 'vitest'
import { sanitizeSearchQuery, DEFAULT_SEARCH_LIMIT } from './search-relays'

describe('DEFAULT_SEARCH_LIMIT', () => {
  it('is exported as 50', () => {
    expect(DEFAULT_SEARCH_LIMIT).toBe(50)
  })
})

describe('sanitizeSearchQuery', () => {
  it('trims whitespace', () => {
    expect(sanitizeSearchQuery('  hello  ')).toBe('hello')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(sanitizeSearchQuery('   ')).toBe('')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeSearchQuery('')).toBe('')
  })

  it('strips control characters', () => {
    expect(sanitizeSearchQuery('hello\x00world\x1f')).toBe('helloworld')
  })

  it('strips DEL character', () => {
    expect(sanitizeSearchQuery('hello\x7fworld')).toBe('helloworld')
  })

  it('collapses internal whitespace', () => {
    expect(sanitizeSearchQuery('hello   world\n\t test')).toBe('hello world test')
  })

  it('truncates to 200 characters', () => {
    const long = 'a'.repeat(300)
    const result = sanitizeSearchQuery(long)
    expect(result.length).toBe(200)
    expect(result).toBe('a'.repeat(200))
  })

  it('preserves normal punctuation and special chars', () => {
    expect(sanitizeSearchQuery('nostr:video #tag @user "quote"')).toBe('nostr:video #tag @user "quote"')
  })

  it('handles mixed trimming and sanitization', () => {
    expect(sanitizeSearchQuery('  neon  lights\x00show  ')).toBe('neon lightsshow')
  })

  it('preserves unicode characters', () => {
    expect(sanitizeSearchQuery('日本語 test 🔥')).toBe('日本語 test 🔥')
  })
})
