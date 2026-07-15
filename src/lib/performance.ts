const isDev = import.meta.env.DEV

const observers: PerformanceObserver[] = []

export function initPerformanceObserver(): void {
  if (!('PerformanceObserver' in window)) return

  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const lastEntry = entries[entries.length - 1]
      if (isDev) {
        console.log('[Perf] LCP:', lastEntry.startTime.toFixed(2), 'ms —', (lastEntry as any).id || '')
      }
    })
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
    observers.push(lcpObserver)
  } catch {}

  try {
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          if (isDev) {
            console.log('[Perf] CLS shift:', (entry as any).value)
          }
        }
      }
    })
    clsObserver.observe({ type: 'layout-shift', buffered: true })
    observers.push(clsObserver)
  } catch {}

  try {
    const inpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const lastEntry = entries[entries.length - 1]
      if (isDev) {
        console.log('[Perf] INP:', lastEntry.duration.toFixed(2), 'ms')
      }
    })
    inpObserver.observe({ type: 'first-input', buffered: true })
    observers.push(inpObserver)
  } catch {}
}

/** Disconnect all performance observers. Safe to call when none are active. */
export function stopPerformanceObservers(): void {
  for (const obs of observers) {
    try { obs.disconnect() } catch {}
  }
  observers.length = 0
}

export function markVideoLoadStart(videoId: string): void {
  performance.mark(`video-load-start:${videoId}`)
}

export function markVideoLoaded(videoId: string): void {
  performance.mark(`video-loaded:${videoId}`)
  performance.measure(`video-load:${videoId}`, `video-load-start:${videoId}`, `video-loaded:${videoId}`)
  const measures = performance.getEntriesByName(`video-load:${videoId}`)
  const duration = measures[measures.length - 1]?.duration
  if (isDev && duration) {
    console.log(`[Perf] Video ${videoId.slice(0, 8)} loaded in ${duration.toFixed(2)}ms`)
  }
  performance.clearMarks(`video-load-start:${videoId}`)
  performance.clearMarks(`video-loaded:${videoId}`)
  performance.clearMeasures(`video-load:${videoId}`)
}

export function markPlaybackEvent(videoId: string, event: string, detail?: Record<string, unknown>): void {
  if (isDev) {
    console.log(`[Perf] Playback ${event} — ${videoId.slice(0, 8)}`, detail ?? '')
  }
}
