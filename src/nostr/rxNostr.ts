/**
 * @deprecated Use `../nostr/pool` instead.
 * This file now re-exports everything from pool.ts so existing imports keep working
 * while we progressively migrate call-sites.
 */
export {
  pool as rxNostr,       // legacy alias — some files still pass this as "rxNostr"
  pool,
  activeRelays,
  setActiveRelays,
  DEFAULT_RELAYS,
  eventStore,
  getEventsQuery$,
  getReplaceableQuery$,
  subscribeToRelays,
  publishToRelays,
  fetchFromRelays,
} from './pool'
