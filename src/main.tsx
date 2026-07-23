import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const root = ReactDOM.createRoot(rootElement)

// The strip window loads the same bundle with a `#strip` hash and mounts only
// the notch view. Import App (and therefore projectStore) *only* in the main
// window — otherwise the store's persist rehydrate side effects run a second
// time in the strip, giving two stores that clobber one localStorage key.
if (window.location.hash === '#strip') {
  // The strip window is transparent; drop the app's opaque background.
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  void import('./components/Notch/NotchStrip').then(({ NotchStrip }) => {
    root.render(
      <React.StrictMode>
        <NotchStrip />
      </React.StrictMode>,
    )
  })
} else {
  void import('./App').then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  })
}
