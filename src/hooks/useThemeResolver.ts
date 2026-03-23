import { useEffect, useRef } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { getElectronAPI } from '../utils/electron'

/**
 * Resolves the active theme (light/dark) from the user's theme preference,
 * applies it to the DOM, and syncs it to Claude Code's config.
 *
 * - When theme is 'system', attaches a matchMedia listener for live OS changes
 * - Debounces Claude Code config sync to handle rapid toggles
 * - Only syncs when resolvedTheme actually changes
 *
 * Internal: setResolvedTheme should only be called from this hook.
 */
export function useThemeResolver() {
  const theme = useProjectStore((s) => s.theme)
  const setResolvedTheme = useProjectStore((s) => s.setResolvedTheme)
  const api = getElectronAPI()
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const applyTheme = (resolved: 'light' | 'dark') => {
      if (resolved === 'dark') {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      const prev = useProjectStore.getState().resolvedTheme
      setResolvedTheme(resolved)
      if (resolved !== prev) {
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
        syncTimeoutRef.current = setTimeout(() => {
          api.app.syncClaudeTheme(resolved).catch((e: unknown) => console.warn('Failed to sync Claude theme:', e))
        }, 200)
      }
    }

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      applyTheme(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => {
        mq.removeEventListener('change', handler)
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
      }
    } else {
      applyTheme(theme)
      return () => {
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
      }
    }
  }, [theme, setResolvedTheme, api])
}
