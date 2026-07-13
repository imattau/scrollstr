import { useCallback, useEffect, useRef, useState } from 'react'

export function usePWAUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const updateRef = useRef<((reloadPage?: boolean) => Promise<void>) | undefined>(undefined)

  useEffect(() => {
    import('virtual:pwa-register').then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh() {
          setNeedRefresh(true)
        },
        onOfflineReady() {
          console.log('[PWA] App ready for offline use')
        },
      })
      updateRef.current = updateSW
    })
  }, [])

  const update = useCallback(() => {
    if (updateRef.current) {
      setNeedRefresh(false)
      updateRef.current(true)
    }
  }, [])

  const dismiss = useCallback(() => setNeedRefresh(false), [])

  return { needRefresh, update, dismiss }
}
