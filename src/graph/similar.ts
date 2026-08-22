import { graph } from './polygraph'
import type { VideoShape } from '../nostr/cache'
import { embedVideo } from './semantic-embedding'

async function vectorSearch(queryVec: number[], topK: number, threshold: number) {
  const { runVectorSearch: search } = await import('../nostr/pool')
  return search(queryVec, topK, threshold)
}

export async function findSimilarVideos(
  videoId: string,
  topK = 10,
  threshold = 0.3,
  excludeIds?: Set<string>
): Promise<VideoShape[]> {
  const refNode = graph.getNode(`shp:${videoId}`)
  if (!refNode) return []

  const video = refNode.data as unknown as VideoShape
  if (!video.videoUrl) return []
  const { vector } = await embedVideo(video)

  const results = await vectorSearch([...vector], topK + 1, threshold)
  if (results.length === 0) return []

  const shapes: VideoShape[] = []
  for (const { id } of results) {
    if (id === videoId) continue
    if (excludeIds?.has(id)) continue
    if (shapes.length >= topK) break
    const shapeNode = graph.getNode(`shp:${id}`)
    if (shapeNode) {
      const data = shapeNode.data as unknown as VideoShape
      if (data.videoUrl && !data.hidden) shapes.push(data)
    }
  }
  return shapes
}

export async function findVideosSimilarToAuthor(
  pubkey: string,
  topK = 10,
  threshold = 0.3
): Promise<VideoShape[]> {
  const authorVectors: number[][] = []
  for (const node of graph.byPubkey(pubkey, 'video_shape')) {
    const data = node.data as Record<string, unknown>
    if (data.videoUrl) {
      const rawId = node.id.includes(':') ? node.id.slice(node.id.indexOf(':') + 1) : node.id
      const vec = graph.vectors.get(rawId)
      if (vec && vec.length === 384) authorVectors.push([...vec])
    }
  }
  if (authorVectors.length === 0) return []

  const dims = authorVectors[0].length
  const avgVec = new Array(dims).fill(0)
  for (const v of authorVectors) {
    for (let i = 0; i < dims; i++) avgVec[i] += v[i] / authorVectors.length
  }

  const results = await vectorSearch(avgVec, topK * 3, threshold)
  if (results.length === 0) return []

  const shapes: VideoShape[] = []
  for (const { id } of results) {
    if (shapes.length >= topK) break
    const shapeNode = graph.getNode(`shp:${id}`)
    if (shapeNode) {
      const data = shapeNode.data as unknown as VideoShape
      if (data.videoUrl && data.pubkey !== pubkey && !data.hidden) shapes.push(data)
    }
  }
  return shapes
}
