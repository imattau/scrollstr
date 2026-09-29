import { BinaryStoreAdapter } from '@0xx0lostcause0xx0/polypack/persistence/opfs'
import { MemoryAdapter } from '@0xx0lostcause0xx0/polypack'
import type { PersistenceAdapter, FileIO } from '@0xx0lostcause0xx0/polypack/persistence'
import { isTauri } from './env'

const DB_NAME = 'scrollstr-polypack'

class TauriFileIO implements FileIO {
  async readFile(name: string): Promise<Uint8Array | null> {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const { appDataDir } = await import('@tauri-apps/api/path')
      const base = await appDataDir()
      const data = await readFile(`${base}polypack/${name}`)
      return new Uint8Array(data)
    } catch {
      return null
    }
  }

  async writeFile(name: string, data: Uint8Array): Promise<void> {
    const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs')
    const { appDataDir } = await import('@tauri-apps/api/path')
    const base = await appDataDir()
    await mkdir(`${base}polypack`, { recursive: true })
    await writeFile(`${base}polypack/${name}`, data)
  }

  async appendFile(name: string, data: Uint8Array): Promise<void> {
    const existing = await this.readFile(name)
    if (existing) {
      const merged = new Uint8Array(existing.length + data.length)
      merged.set(existing)
      merged.set(data, existing.length)
      await this.writeFile(name, merged)
    } else {
      await this.writeFile(name, data)
    }
  }

  async deleteFile(name: string): Promise<void> {
    try {
      const { remove } = await import('@tauri-apps/plugin-fs')
      const { appDataDir } = await import('@tauri-apps/api/path')
      const base = await appDataDir()
      await remove(`${base}polypack/${name}`)
    } catch {
      // file may not exist
    }
  }

  async fileExists(name: string): Promise<boolean> {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const { appDataDir } = await import('@tauri-apps/api/path')
    const base = await appDataDir()
    return exists(`${base}polypack/${name}`)
  }
}

async function supportsOPFS(): Promise<boolean> {
  try {
    // The `getDirectory` function can exist on the API surface even where it
    // doesn't actually work — notably on Android, where Tauri serves the app
    // from http://tauri.localhost, which Android WebView does not treat as a
    // secure context, and OPFS strictly requires one. Calling it (rather
    // than just feature-detecting the function reference) is the only way
    // to catch that: it throws there instead of resolving.
    if (typeof navigator?.storage?.getDirectory !== 'function') return false
    await navigator.storage.getDirectory()
    return true
  } catch {
    return false
  }
}

let _adapter: PersistenceAdapter | null = null

export async function createPersistenceAdapter(): Promise<PersistenceAdapter> {
  if (_adapter) return _adapter

  if (!isTauri()) {
    // Same false-positive risk as the Tauri/Android case below: the browser
    // can expose `navigator.storage.getDirectory` without OPFS actually
    // working (non-HTTPS deployments, some embedded WebViews), which would
    // otherwise surface as writes failing deep inside BinaryStoreAdapter's
    // I/O path instead of a clean fallback here.
    if (await supportsOPFS()) {
      _adapter = new BinaryStoreAdapter({ storeDir: DB_NAME })
      return _adapter
    }
    _adapter = new MemoryAdapter()
    return _adapter
  }

  // Tauri environment: try OPFS first, fall back to Tauri FS
  try {
    if (await supportsOPFS()) {
      _adapter = new BinaryStoreAdapter({ storeDir: DB_NAME })
      return _adapter
    }
  } catch {
    // OPFS not available, use Tauri filesystem
  }

  try {
    _adapter = new BinaryStoreAdapter({
      storeDir: DB_NAME,
      fileIO: new TauriFileIO(),
    })
    return _adapter
  } catch {
    // Last resort: in-memory only
    _adapter = new MemoryAdapter()
    return _adapter
  }
}
