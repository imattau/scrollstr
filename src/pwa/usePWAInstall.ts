import { useEffect, useState } from 'react'
import { isTauri } from '../tauri/env'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
}

export function usePWAInstall() {
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstallable, setIsInstallable] = useState(false)

  useEffect(() => {
    if (isTauri()) return

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                         (window.navigator as any).standalone === true

    if (isStandalone) {
      setIsInstallable(false)
      return
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setInstallPromptEvent(e as BeforeInstallPromptEvent)
      setIsInstallable(true)
    }

    const handleCustomPWAInstallable = (e: Event) => {
      const customEvent = e as CustomEvent<BeforeInstallPromptEvent>
      if (customEvent.detail) {
        setInstallPromptEvent(customEvent.detail)
        setIsInstallable(true)
      }
    }

    const handleAppInstalled = () => {
      setInstallPromptEvent(null)
      setIsInstallable(false)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('pwa-installable', handleCustomPWAInstallable)
    window.addEventListener('appinstalled', handleAppInstalled)

    if ((window as any).deferredInstallPrompt) {
      setInstallPromptEvent((window as any).deferredInstallPrompt)
      setIsInstallable(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('pwa-installable', handleCustomPWAInstallable)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const installApp = async () => {
    if (!installPromptEvent) {
      return false
    }

    try {
      await installPromptEvent.prompt()
      const choiceResult = await installPromptEvent.userChoice

      if (choiceResult.outcome === 'accepted') {
        ;(window as any).deferredInstallPrompt = null
        setInstallPromptEvent(null)
        setIsInstallable(false)
        return true
      }
    } catch (error) {
      console.error('Error during PWA installation prompt:', error)
    }
    return false
  }

  return { isInstallable, installApp }
}
