import { useEffect, useRef } from 'react'
import { apiClient } from '../api/client'

// Subscribes the mounted screen to apiClient events (remote or local) and
// re-reads data via `load` whenever one is applied. Never calls `load` on
// mount — screens already load on mount. `load` is kept in a ref so a
// changing identity never re-subscribes (and never leaks subscriptions).
export function useLiveData(load: () => void | Promise<void>): void {
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    return apiClient.subscribe(() => {
      void loadRef.current()
    })
  }, [])
}
