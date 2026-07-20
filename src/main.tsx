import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { NotchStrip } from './components/Notch/NotchStrip'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

// The strip window loads the same bundle with a `#strip` hash and mounts the
// notch view instead of the full app. Its window is transparent, so drop the
// app's opaque background in this mode.
const isStrip = window.location.hash === '#strip'
if (isStrip) {
  document.documentElement.classList.add('notch-window')
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>{isStrip ? <NotchStrip /> : <App />}</React.StrictMode>,
)
