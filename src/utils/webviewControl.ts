import type { CommandWebviewElement, NativeImageLike } from '../types/webview'

// Ready-guarded wrappers around the <webview>'s host-side control surface.
//
// Webview methods throw synchronously if called before the guest's dom-ready,
// so callers pass the current ready flag; when the guest isn't attached (or the
// ref is null) these resolve to null instead of throwing — mirroring the
// readyRef guard BrowserTab already uses for live-reload. They also swallow a
// late async rejection (the guest frame torn down mid-call, e.g. a live-reload
// firing during an in-flight annotation action) to null, so callers surface a
// status instead of leaking an unhandled promise rejection.
//
// This is the ONLY channel the annotation modes use to reach the page:
// host-pull. No preload or bridge is injected into the guest, so the webview
// hardening (webviewSecurity.hardenWebviewPreferences) stays intact.

/** Run a JS expression in the guest and resolve with its return value. */
export async function execInGuest(
  webview: CommandWebviewElement | null,
  ready: boolean,
  code: string
): Promise<unknown> {
  if (!webview || !ready) return null
  try {
    return await webview.executeJavaScript(code)
  } catch {
    return null
  }
}

/** Capture the guest page (including anything injected into it) as an image. */
export async function captureGuest(
  webview: CommandWebviewElement | null,
  ready: boolean
): Promise<NativeImageLike | null> {
  if (!webview || !ready) return null
  try {
    const image = await webview.capturePage()
    return image.isEmpty() ? null : image
  } catch {
    return null
  }
}
