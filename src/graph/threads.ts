import { graph } from './polygraph'
import type { PolyNode } from './types'

export interface ThreadNode {
  eventId: string
  pubkey: string
  kind: number
  created_at: number
  content?: string
  parentId?: string
  children: ThreadNode[]
}

/**
 * Recursively build a reply tree from the graph by following REFERENCES
 * edges in reverse (in-edges). Start from `rootEventId` and traverse up
 * to `maxDepth`.
 *
 * Uses `graph.getEdgeSources(target, 'REFERENCES')` to find all events whose
 * REFERENCES edge targets the given event — i.e. direct replies.
 * This is O(|replies| × depth) = O(|thread|) and relies only on the
 * public graph API.
 */
function buildThread(
  rootEventId: string,
  depth: number,
  maxDepth: number,
): ThreadNode[] {
  if (depth >= maxDepth) return []

  const replyIds = graph.getEdgeSources(`evt:${rootEventId}`, 'REFERENCES')
  const nodes: ThreadNode[] = []

  for (const sourceId of replyIds) {
    const node: PolyNode | undefined = graph.getNode(sourceId)
    if (!node || node.type !== 'event') continue

    const data = node.data as Record<string, unknown>
    const rawEvent = data.event as any

    nodes.push({
      eventId: data.id as string,
      pubkey: data.pubkey as string,
      kind: data.kind as number,
      created_at: data.created_at as number,
      content: rawEvent?.content,
      parentId: rootEventId,
      children: buildThread(data.id as string, depth + 1, maxDepth),
    })
  }

  // Sorted by created_at ascending so oldest reply comes first.
  nodes.sort((a, b) => a.created_at - b.created_at)

  return nodes
}

/**
 * Build a reply thread rooted at `rootEventId` by traversing REFERENCES
 * edges in the in-memory graph. Only events already stored in the graph
 * are included — live replies not yet cached are absent (the caller should
 * still fetch them via Nostr subscriptions for freshness).
 *
 * Returns an empty array when the root event is missing from the graph.
 */
export function findThread(
  rootEventId: string,
  maxDepth = 5,
): ThreadNode[] {
  const rootNode = graph.getNode(`evt:${rootEventId}`)
  if (!rootNode) return []

  const data = rootNode.data as Record<string, unknown>
  const rawEvent = data.event as any

  const root: ThreadNode = {
    eventId: rootEventId,
    pubkey: data.pubkey as string,
    kind: data.kind as number,
    created_at: data.created_at as number,
    content: rawEvent?.content,
    children: buildThread(rootEventId, 0, maxDepth),
  }

  return [root]
}
