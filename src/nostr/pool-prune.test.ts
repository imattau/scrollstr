import { beforeEach, describe, expect, it } from 'vitest'
import type { SerializedNode } from '@0xx0lostcause0xx0/polypack'
import { graph } from '../graph'
import { prunePersistedCache } from './pool'

function node(id: string, type: string, data: Record<string, unknown>, updatedAt = 1): SerializedNode {
  return { id, type, data, vector: null, insertedAt: updatedAt, updatedAt }
}

beforeEach(async () => {
  graph.clear()
  await graph.persistence.clearAll()
})

describe('persisted cache maintenance', () => {
  it('cleans legacy rejections and orphan records below the video limit', async () => {
    await graph.persistence.bulkPutNodes([
      node('shp:kept', 'video_shape', { id: 'kept', videoUrl: 'https://cdn/kept.mp4', pubkey: 'alice', insertOrder: 2 }),
      node('evt:kept', 'event', { id: 'kept', kind: 21, pubkey: 'alice' }),
      node('rej:legacy', 'rejection', { checkedAt: Date.now() }),
      node('med:https://cdn/orphan.mp4', 'media', { url: 'https://cdn/orphan.mp4' }),
      node('sta:orphan', 'user_state', { id: 'orphan' }),
      node('cnt:orphan', 'counter', { id: 'orphan' }),
      node('pro:bob', 'profile', { pubkey: 'bob' }),
    ])

    await prunePersistedCache({ maxVideos: 10, maxEvents: 10 })

    expect(await graph.persistence.getNode('shp:kept')).toBeDefined()
    expect(await graph.persistence.getNode('rej:legacy')).toBeUndefined()
    expect(await graph.persistence.getNode('med:https://cdn/orphan.mp4')).toBeUndefined()
    expect(await graph.persistence.getNode('sta:orphan')).toBeUndefined()
    expect(await graph.persistence.getNode('cnt:orphan')).toBeUndefined()
    expect(await graph.persistence.getNode('pro:bob')).toBeUndefined()
  })

  it('prunes a video and all dependent nodes, vectors, and edges', async () => {
    await graph.persistence.bulkPutNodes([
      node('shp:old', 'video_shape', { id: 'old', videoUrl: 'https://cdn/old.mp4', pubkey: 'alice', insertOrder: 1 }),
      node('shp:new', 'video_shape', { id: 'new', videoUrl: 'https://cdn/new.mp4', pubkey: 'alice', insertOrder: 2 }),
      node('evt:old', 'event', { id: 'old', kind: 21, pubkey: 'alice' }),
      node('evt:new', 'event', { id: 'new', kind: 21, pubkey: 'alice' }),
      node('evt:like-old', 'event', { id: 'like-old', kind: 7, pubkey: 'bob', eTags: ['old'] }),
      node('med:https://cdn/old.mp4', 'media', { url: 'https://cdn/old.mp4' }),
      node('sta:old', 'user_state', { id: 'old' }),
      node('cnt:old', 'counter', { id: 'old' }),
    ])
    await graph.persistence.putVector('old', [1, 0])
    await graph.persistence.putEdge({ id: 'edge-old-media', source: 'old', target: 'https://cdn/old.mp4', type: 'HAS_MEDIA', data: null, createdAt: 1 })

    await prunePersistedCache({ maxVideos: 1, maxEvents: 10 })

    for (const id of ['shp:old', 'evt:old', 'evt:like-old', 'med:https://cdn/old.mp4', 'sta:old', 'cnt:old']) {
      expect(await graph.persistence.getNode(id), id).toBeUndefined()
    }
    expect(await graph.persistence.getNode('shp:new')).toBeDefined()
    expect((await graph.persistence.getAllVectors()).some(({ id }) => id === 'old')).toBe(false)
    expect(await graph.persistence.getAllEdges()).toHaveLength(0)
  })

  it('enforces the event cap even when no videos need pruning', async () => {
    await graph.persistence.bulkPutNodes([
      node('evt:1', 'event', { id: '1', kind: 0, pubkey: 'a' }, 1),
      node('evt:2', 'event', { id: '2', kind: 0, pubkey: 'a' }, 2),
      node('evt:3', 'event', { id: '3', kind: 0, pubkey: 'a' }, 3),
      node('evt:4', 'event', { id: '4', kind: 0, pubkey: 'a' }, 4),
    ])

    await prunePersistedCache({ maxVideos: 10, maxEvents: 2 })
    const events = await graph.persistence.queryNodes?.({ nodeTypes: ['event'] })
    expect(events).toHaveLength(2)
    expect(events?.map(({ id }) => id).sort()).toEqual(['evt:3', 'evt:4'])
  })
})
