import { graph, computeEventVector } from './polygraph'
import type { VideoShape } from '../nostr/cache'

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
  const refNode = graph.getNode(`evt:${videoId}`)
  if (!refNode) return []

  const kind = refNode.data.kind as number | undefined
  if (!kind || ![1, 21, 22, 34236].includes(kind)) return []

  const eTags = (refNode.data.eTags as string[]) ?? []
  const pTags = (refNode.data.pTags as string[]) ?? []
  const hashtags = (refNode.data.hashtags as string[]) ?? []
  const pubkey = refNode.data.pubkey as string
  const created_at = refNode.data.created_at as number

  const queryVec = computeEventVector({
    kind, pubkey, created_at,
    eTagsCount: eTags.length,
    pTagsCount: pTags.length,
    hashtags,
  })

  const results = await vectorSearch(queryVec, topK + 1, threshold)
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
      if (vec) authorVectors.push(vec)
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
