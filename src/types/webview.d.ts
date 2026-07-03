import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// Type support for Electron's <webview> custom element in the renderer.
// We declare only the surface BrowserTab drives, so the renderer needn't pull
// in Electron's full type namespace.

/** The subset of Electron's WebviewTag API that the built-in browser uses. */
export interface CommandWebviewElement extends HTMLElement {
  src: string
  loadURL(url: string): Promise<void>
  getURL(): string
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  openDevTools(): void
}

interface WebviewAttributes extends HTMLAttributes<CommandWebviewElement> {
  src?: string
  partition?: string
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<WebviewAttributes, CommandWebviewElement>
    }
  }
}
