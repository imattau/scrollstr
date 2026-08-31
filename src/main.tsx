import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './layers.css'
import './index.css'
import 'react-media-stack/dist/index.css'
import App from './app/App.tsx'
import { initPerformanceObserver } from './lib/performance'
import { isTauri } from './tauri/env'
import * as memoryProfile from './graph/memory-profile'

initPerformanceObserver()

// Exposed for diagnosing memory usage from DevTools: run
// `scrollstrDebug.printGraphMemorySizes()` in the console to see node counts
// and estimated payload sizes per type in the graph's hot cache.
;(globalThis as unknown as { scrollstrDebug: typeof memoryProfile }).scrollstrDebug = memoryProfile

async function init() {
  if (isTauri()) {
    const { createPersistenceAdapter } = await import('./tauri/graph-adapter')
    const { swapGraphPersistence } = await import('./graph/polygraph')
    try {
      const adapter = await createPersistenceAdapter()
      await swapGraphPersistence(adapter)
    } catch (err) {
      console.warn('[tauri] Failed to set up Tauri persistence adapter:', err)
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

init()
