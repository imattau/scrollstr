import { useEffect, useState } from 'react'

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
    // Check if app is already running as standalone (installed)
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
      console.log('PWA was installed')
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('pwa-installable', handleCustomPWAInstallable)
    window.addEventListener('appinstalled', handleAppInstalled)

    // Check if prompt was already captured by window before hook registered listeners
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
      console.warn('Install prompt is not available')
      return false
    }

    try {
      await installPromptEvent.prompt()
      const choiceResult = await installPromptEvent.userChoice
      console.log(`User response to install prompt: ${choiceResult.outcome}`)

      if (choiceResult.outcome === 'accepted') {
        // Clear cached prompt
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
