import type { DetailedHTMLProps, HTMLAttributes } from 'react'

// Type support for Electron's <webview> custom element in the renderer.
// We declare only the surface BrowserTab drives, so the renderer needn't pull
// in Electron's full type namespace.

/**
 * Minimal shape of the NativeImage that `capturePage()` resolves to. The
 * renderer only needs a data URL (to hand to `clipboard.writeImage`) and an
 * emptiness check, so we avoid pulling in Electron's full type namespace.
 */
export interface NativeImageLike {
  toDataURL(): string
  isEmpty(): boolean
}

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
  // Host-pull control surface for the annotation modes. Both are native on the
  // WebviewTag; declared here because annotation drives them from the host.
  executeJavaScript(code: string): Promise<unknown>
  capturePage(): Promise<NativeImageLike>
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
