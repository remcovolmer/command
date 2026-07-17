import { describe, test, expect, vi } from 'vitest'
import {
  execInGuest,
  captureGuest,
  setZoom,
  findInGuest,
  stopFind,
} from '../src/utils/webviewControl'
import type { CommandWebviewElement, NativeImageLike } from '../src/types/webview'

function fakeWebview(overrides: Partial<CommandWebviewElement> = {}): CommandWebviewElement {
  return {
    executeJavaScript: vi.fn().mockResolvedValue('result'),
    capturePage: vi
      .fn()
      .mockResolvedValue({ toDataURL: () => 'data:image/png;base64,AAA', isEmpty: () => false }),
    setZoomFactor: vi.fn(),
    findInPage: vi.fn().mockReturnValue(7),
    stopFindInPage: vi.fn(),
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

  test('resolves to null (not reject) when the guest call rejects mid-flight', async () => {
    const wv = fakeWebview({
      executeJavaScript: vi.fn().mockRejectedValue(new Error('frame was disposed')),
    } as Partial<CommandWebviewElement>)
    await expect(execInGuest(wv, true, 'x')).resolves.toBeNull()
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

  test('resolves to null (not reject) when capture rejects mid-flight', async () => {
    const wv = fakeWebview({
      capturePage: vi.fn().mockRejectedValue(new Error('frame was disposed')),
    } as Partial<CommandWebviewElement>)
    await expect(captureGuest(wv, true)).resolves.toBeNull()
  })
})

describe('setZoom', () => {
  test('returns false and does not call the guest when null or not ready', () => {
    expect(setZoom(null, true, 1.5)).toBe(false)
    const wv = fakeWebview()
    expect(setZoom(wv, false, 1.5)).toBe(false)
    expect(wv.setZoomFactor).not.toHaveBeenCalled()
  })

  test('applies the factor and returns true when ready', () => {
    const wv = fakeWebview()
    expect(setZoom(wv, true, 1.5)).toBe(true)
    expect(wv.setZoomFactor).toHaveBeenCalledWith(1.5)
  })

  test('returns false (not throw) when the guest call throws mid-flight', () => {
    const wv = fakeWebview({
      setZoomFactor: vi.fn(() => {
        throw new Error('not attached')
      }),
    } as Partial<CommandWebviewElement>)
    expect(setZoom(wv, true, 2)).toBe(false)
  })
})

describe('findInGuest', () => {
  test('returns null when null, not ready, or the term is empty', () => {
    expect(findInGuest(null, true, 'x')).toBeNull()
    const wv = fakeWebview()
    expect(findInGuest(wv, false, 'x')).toBeNull()
    expect(findInGuest(wv, true, '')).toBeNull()
    expect(wv.findInPage).not.toHaveBeenCalled()
  })

  test('passes the term and options through and returns the request id', () => {
    const wv = fakeWebview()
    const id = findInGuest(wv, true, 'needle', { findNext: true, forward: false })
    expect(wv.findInPage).toHaveBeenCalledWith('needle', { findNext: true, forward: false })
    expect(id).toBe(7)
  })

  test('returns null (not throw) when the guest call throws mid-flight', () => {
    const wv = fakeWebview({
      findInPage: vi.fn(() => {
        throw new Error('not attached')
      }),
    } as Partial<CommandWebviewElement>)
    expect(findInGuest(wv, true, 'x')).toBeNull()
  })
})

describe('stopFind', () => {
  test('does nothing when null or not ready', () => {
    const wv = fakeWebview()
    stopFind(null, true)
    stopFind(wv, false)
    expect(wv.stopFindInPage).not.toHaveBeenCalled()
  })

  test('clears the selection by default when ready', () => {
    const wv = fakeWebview()
    stopFind(wv, true)
    expect(wv.stopFindInPage).toHaveBeenCalledWith('clearSelection')
  })

  test('swallows a mid-flight throw', () => {
    const wv = fakeWebview({
      stopFindInPage: vi.fn(() => {
        throw new Error('not attached')
      }),
    } as Partial<CommandWebviewElement>)
    expect(() => stopFind(wv, true)).not.toThrow()
  })
})
