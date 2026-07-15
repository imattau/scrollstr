import type { SerializedNode, SerializedEdge, NodeType, EdgeType } from './types'

const DB_NAME = 'scrollstr-polygraph'
const DB_VERSION = 2

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result

      // ── V1: initial schema ──
      if (!db.objectStoreNames.contains('nodes')) {
        const store = db.createObjectStore('nodes', { keyPath: 'id' })
        store.createIndex('type', 'type', { unique: false })
      }
      if (!db.objectStoreNames.contains('edges')) {
        const store = db.createObjectStore('edges', { keyPath: 'id' })
        store.createIndex('source', 'source', { unique: false })
        store.createIndex('target', 'target', { unique: false })
        store.createIndex('type', 'type', { unique: false })
      }
      if (!db.objectStoreNames.contains('vectors')) {
        db.createObjectStore('vectors', { keyPath: 'id' })
      }

      // ── V2: replaceable-key index (added after V1 stores exist) ──
      if (db.objectStoreNames.contains('nodes')) {
        const tx = req.transaction
        const store = tx?.objectStore('nodes')
        if (store && !store.indexNames.contains('by_replaceable')) {
          store.createIndex('by_replaceable', 'replaceableKey', { unique: false })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export class PolyPersistence {
  private dbPromise: Promise<IDBDatabase> | null = null

  private async db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB()
    }
    return this.dbPromise
  }

  // ── Node Operations ──

  async putNode(node: SerializedNode): Promise<void> {
    const database = await this.db()
    const tx = database.transaction('nodes', 'readwrite')
    tx.objectStore('nodes').put(node)
    await idbTransaction(tx)
  }

  async bulkPutNodes(nodes: SerializedNode[]): Promise<void> {
    if (nodes.length === 0) return
    const database = await this.db()
    const tx = database.transaction('nodes', 'readwrite')
    const store = tx.objectStore('nodes')
    for (const node of nodes) store.put(node)
    await idbTransaction(tx)
  }

  async getNode(id: string): Promise<SerializedNode | undefined> {
    const database = await this.db()
    return idbRequest(database.transaction('nodes').objectStore('nodes').get(id))
  }

  async getNodes(ids: string[]): Promise<SerializedNode[]> {
    if (ids.length === 0) return []
    const database = await this.db()
    const results: SerializedNode[] = []
    const tx = database.transaction('nodes')
    const store = tx.objectStore('nodes')
    for (const id of ids) {
      const node = await idbRequest(store.get(id))
      if (node) results.push(node)
    }
    return results
  }

  async deleteNode(id: string): Promise<void> {
    const database = await this.db()
    const tx = database.transaction('nodes', 'readwrite')
    tx.objectStore('nodes').delete(id)
    await idbTransaction(tx)
  }

  async bulkDeleteNodes(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const database = await this.db()
    const tx = database.transaction('nodes', 'readwrite')
    const store = tx.objectStore('nodes')
    for (const id of ids) store.delete(id)
    await idbTransaction(tx)
  }

  async countNodes(type?: NodeType): Promise<number> {
    const database = await this.db()
    const tx = database.transaction('nodes')
    const store = tx.objectStore('nodes')
    if (type) {
      const range = IDBKeyRange.only(type)
      return idbRequest(store.index('type').count(range))
    }
    return idbRequest(store.count())
  }

  async allNodeIds(type?: NodeType): Promise<string[]> {
    const database = await this.db()
    const tx = database.transaction('nodes')
    const store = tx.objectStore('nodes')
    const ids: string[] = []
    const source = type
      ? store.index('type').openCursor(IDBKeyRange.only(type))
      : store.openCursor()
    return new Promise((resolve, reject) => {
      source.onsuccess = () => {
        const cursor = source.result
        if (cursor) {
          ids.push(cursor.primaryKey as string)
          cursor.continue()
        } else {
          resolve(ids)
        }
      }
      source.onerror = () => reject(source.error)
    })
  }

  /** Return serialized nodes whose `replaceableKey` matches, via the
   *  `by_replaceable` index. */
  async getNodesByReplaceableKey(key: string): Promise<SerializedNode[]> {
    const database = await this.db()
    const tx = database.transaction('nodes')
    const store = tx.objectStore('nodes')
    const index = store.index('by_replaceable')
    const nodes: SerializedNode[] = []
    return new Promise((resolve, reject) => {
      const req = index.openCursor(IDBKeyRange.only(key))
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          nodes.push(cursor.value as SerializedNode)
          cursor.continue()
        } else {
          resolve(nodes)
        }
      }
      req.onerror = () => reject(req.error)
    })
  }

  /** Persist a replaceable event node. If an older version with the same
   *  `replaceableKey` exists in IDB and its `data.created_at` is older,
   *  the old row is deleted first. Then the new node is written. */
  async putReplaceable(node: SerializedNode): Promise<void> {
    if (!node.replaceableKey) {
      // Not actually replaceable — write normally.
      await this.putNode(node)
      return
    }
    const existing = await this.getNodesByReplaceableKey(node.replaceableKey)
    const nodeCreatedAt = (node.data.created_at as number) ?? 0
    for (const old of existing) {
      if (old.id === node.id) continue
      const oldCreatedAt = (old.data.created_at as number) ?? 0
      if (oldCreatedAt <= nodeCreatedAt) {
        // New event is newer or equal — delete the stale row (tie → existing wins).
        await this.deleteNode(old.id)
      } else {
        // Stored version is newer — skip the insert entirely.
        return
      }
    }
    await this.putNode(node)
  }

  // ── Edge Operations ──

  async putEdge(edge: SerializedEdge): Promise<void> {
    const database = await this.db()
    const tx = database.transaction('edges', 'readwrite')
    tx.objectStore('edges').put(edge)
    await idbTransaction(tx)
  }

  async bulkPutEdges(edges: SerializedEdge[]): Promise<void> {
    if (edges.length === 0) return
    const database = await this.db()
    const tx = database.transaction('edges', 'readwrite')
    const store = tx.objectStore('edges')
    for (const edge of edges) store.put(edge)
    await idbTransaction(tx)
  }

  async getAllEdges(): Promise<SerializedEdge[]> {
    const database = await this.db()
    const tx = database.transaction('edges')
    const results: SerializedEdge[] = []
    return new Promise((resolve, reject) => {
      const req = tx.objectStore('edges').openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }
      req.onerror = () => reject(req.error)
    })
  }

  async getEdgesBySource(source: string, type?: EdgeType): Promise<SerializedEdge[]> {
    const database = await this.db()
    const tx = database.transaction('edges')
    const store = tx.objectStore('edges')
    const index = store.index('source')
    const results: SerializedEdge[] = []
    return new Promise((resolve, reject) => {
      const req = index.openCursor(IDBKeyRange.only(source))
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          if (!type || cursor.value.type === type) results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }
      req.onerror = () => reject(req.error)
    })
  }

  async getEdgesByTarget(target: string, type?: EdgeType): Promise<SerializedEdge[]> {
    const database = await this.db()
    const tx = database.transaction('edges')
    const store = tx.objectStore('edges')
    const index = store.index('target')
    const results: SerializedEdge[] = []
    return new Promise((resolve, reject) => {
      const req = index.openCursor(IDBKeyRange.only(target))
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          if (!type || cursor.value.type === type) results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }
      req.onerror = () => reject(req.error)
    })
  }

  async deleteEdgesBySource(source: string, type?: EdgeType): Promise<void> {
    const database = await this.db()
    const tx = database.transaction('edges', 'readwrite')
    const store = tx.objectStore('edges')
    const index = store.index('source')
    return new Promise((resolve, reject) => {
      const req = index.openCursor(IDBKeyRange.only(source))
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          if (!type || cursor.value.type === type) store.delete(cursor.primaryKey as string)
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async deleteEdge(id: string): Promise<void> {
    const database = await this.db()
    const tx = database.transaction('edges', 'readwrite')
    tx.objectStore('edges').delete(id)
    await idbTransaction(tx)
  }

  async countEdges(type?: EdgeType): Promise<number> {
    const database = await this.db()
    const tx = database.transaction('edges')
    const store = tx.objectStore('edges')
    if (type) return idbRequest(store.index('type').count(IDBKeyRange.only(type)))
    return idbRequest(store.count())
  }

  // ── Vector Operations ──

  async putVector(id: string, vector: number[]): Promise<void> {
    const database = await this.db()
    const tx = database.transaction('vectors', 'readwrite')
    tx.objectStore('vectors').put({ id, vector })
    await idbTransaction(tx)
  }

  async bulkPutVectors(entries: Array<{ id: string; vector: number[] }>): Promise<void> {
    if (entries.length === 0) return
    const database = await this.db()
    const tx = database.transaction('vectors', 'readwrite')
    const store = tx.objectStore('vectors')
    for (const entry of entries) store.put(entry)
    await idbTransaction(tx)
  }

  async deleteVector(id: string): Promise<void> {
    const database = await this.db()
    const tx = database.transaction('vectors', 'readwrite')
    tx.objectStore('vectors').delete(id)
    await idbTransaction(tx)
  }

  async getAllVectors(): Promise<Array<{ id: string; vector: number[] }>> {
    const database = await this.db()
    const tx = database.transaction('vectors')
    const results: Array<{ id: string; vector: number[] }> = []
    return new Promise((resolve, reject) => {
      const req = tx.objectStore('vectors').openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          results.push(cursor.value)
          cursor.continue()
        } else {
          resolve(results)
        }
      }
      req.onerror = () => reject(req.error)
    })
  }

  // ── Migration ──

  async clearAll(): Promise<void> {
    const database = await this.db()
    const stores = ['nodes', 'edges', 'vectors']
    const tx = database.transaction(stores, 'readwrite')
    for (const store of stores) tx.objectStore(store).clear()
    await idbTransaction(tx)
  }

  /** Close the cached IDBDatabase connection (if any) without deleting data.
   *  Safe to call when no connection is open. Subsequent operations will
   *  re-open the connection lazily via `db()`. */
  async close(): Promise<void> {
    if (!this.dbPromise) return
    try {
      const database = await this.dbPromise
      database.close()
    } catch (err) {
      console.warn('[PolyPersistence] close failed:', err)
    }
    this.dbPromise = null
  }

  async destroy(): Promise<void> {
    await this.close()
    indexedDB.deleteDatabase(DB_NAME)
  }
}
