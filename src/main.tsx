import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './layers.css'
import './index.css'
import 'react-media-stack/dist/index.css'
import App from './app/App.tsx'
import { initPerformanceObserver } from './lib/performance'

initPerformanceObserver()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
