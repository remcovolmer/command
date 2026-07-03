import { describe, test, expect, vi } from 'vitest'
import { execInGuest, captureGuest } from '../src/utils/webviewControl'
import type { CommandWebviewElement, NativeImageLike } from '../src/types/webview'

function fakeWebview(overrides: Partial<CommandWebviewElement> = {}): CommandWebviewElement {
  return {
    executeJavaScript: vi.fn().mockResolvedValue('result'),
    capturePage: vi
      .fn()
      .mockResolvedValue({ toDataURL: () => 'data:image/png;base64,AAA', isEmpty: () => false }),
    ...overrides,
  } as unknown as CommandWebviewElement
}

describe('execInGuest', () => {
  test('returns null when the webview ref is null', async () => {
    expect(await execInGuest(null, true, 'x')).toBeNull()
  })

  test('returns null and does not call the guest before dom-ready', async () => {
    const wv = fakeWebview()
    expect(await execInGuest(wv, false, 'x')).toBeNull()
    expect(wv.executeJavaScript).not.toHaveBeenCalled()
  })

  test('passes code through and returns the guest result when ready', async () => {
    const wv = fakeWebview()
    const result = await execInGuest(wv, true, 'document.title')
    expect(wv.executeJavaScript).toHaveBeenCalledWith('document.title')
    expect(result).toBe('result')
  })
})

describe('captureGuest', () => {
  test('returns null and does not capture before dom-ready', async () => {
    const wv = fakeWebview()
    expect(await captureGuest(wv, false)).toBeNull()
    expect(wv.capturePage).not.toHaveBeenCalled()
  })

  test('returns the image when ready and non-empty', async () => {
    const wv = fakeWebview()
    const img = await captureGuest(wv, true)
    expect(img?.toDataURL()).toContain('data:image/png')
  })

  test('returns null when the capture is empty', async () => {
    const empty: NativeImageLike = { toDataURL: () => '', isEmpty: () => true }
    const wv = fakeWebview({
      capturePage: vi.fn().mockResolvedValue(empty),
    } as Partial<CommandWebviewElement>)
    expect(await captureGuest(wv, true)).toBeNull()
  })
})
