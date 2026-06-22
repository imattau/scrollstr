import React, { useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AppRouter } from './router'
import { LoginSheet } from '../features/auth/LoginSheet'
import { NostrProvider } from './providers'

function App() {
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [userSession, setUserSession] = useState<{ method: string; pubkey?: string } | null>(null)

  const handleActionTrigger = (actionType: string) => {
    // If not logged in, trigger login modal
    if (!userSession) {
      console.log(`Action '${actionType}' requires login. Opening Login Sheet.`)
      setIsLoginOpen(true)
    } else {
      console.log(`User is already logged in with ${userSession.method}. Performing action: ${actionType}`)
    }
  }

  const handleLoginSuccess = (method: string, data?: string) => {
    console.log(`Login successful via ${method}: ${data}`)
    setUserSession({ method, pubkey: data })
    setIsLoginOpen(false)
  }

  return (
    <NostrProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-neutral-950 font-sans text-neutral-100">
          <AppRouter onActionTrigger={handleActionTrigger} />
          
          {/* Auth Sheets / Dialogs */}
          <LoginSheet
            isOpen={isLoginOpen}
            onClose={() => setIsLoginOpen(false)}
            onLoginSuccess={handleLoginSuccess}
          />
        </div>
      </BrowserRouter>
    </NostrProvider>
  )
}

export default App
