import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} })

export const useToast = () => useContext(ToastContext)

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
}

const BORDER_COLORS: Record<ToastType, string> = {
  success: 'border-green-500/40',
  error: 'border-red-500/40',
  info: 'border-purple-500/40',
}

const BG_COLORS: Record<ToastType, string> = {
  success: 'bg-green-500/10',
  error: 'bg-red-500/10',
  info: 'bg-purple-500/10',
}

const TEXT_COLORS: Record<ToastType, string> = {
  success: 'text-green-300',
  error: 'text-red-300',
  info: 'text-purple-300',
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)
  // Track pending per-toast timer IDs so we can clear them on unmount.
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++idRef.current
    setToasts(prev => [...prev, { id, message, type }])
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
      timersRef.current.delete(timer)
    }, 4000)
    timersRef.current.add(timer)
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-24 left-1/2 z-[70] flex -translate-x-1/2 flex-col gap-2 md:bottom-6">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 rounded-xl border ${BORDER_COLORS[t.type]} ${BG_COLORS[t.type]} px-4 py-2.5 shadow-lg backdrop-blur-md animate-[toast-in_0.25s_ease-out]`}
            style={{ minWidth: 200, maxWidth: 360 }}
          >
            <span className={`text-[13px] font-bold ${TEXT_COLORS[t.type]}`}>{ICONS[t.type]}</span>
            <span className="text-[13px] font-medium text-[#f7f7f8]">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
