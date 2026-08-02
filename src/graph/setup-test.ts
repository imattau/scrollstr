import { BinaryStoreAdapter } from '@0xx0lostcause0xx0/polypack/persistence/opfs'
import { MemoryFileIO } from '@0xx0lostcause0xx0/polypack/persistence'
import { setPersistenceFactory } from './scrollstr-graph'

setPersistenceFactory(() => new BinaryStoreAdapter({ storeDir: 'test', fileIO: new MemoryFileIO() }))
