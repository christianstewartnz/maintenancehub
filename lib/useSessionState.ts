'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * useState that survives leaving and coming back to a page within the same tab
 * (e.g. list filters after opening an item). Stored in sessionStorage, so it
 * resets when the tab is closed.
 *
 * Restored after mount (not in the initialiser) so server and client render the same HTML.
 */
export function useSessionState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial)

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from sessionStorage after hydration
      if (saved !== null) setValue(JSON.parse(saved) as T)
    } catch {}
  }, [key])

  const update = useCallback((next: T) => {
    setValue(next)
    try {
      sessionStorage.setItem(key, JSON.stringify(next))
    } catch {}
  }, [key])

  return [value, update] as const
}
