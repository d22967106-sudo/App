import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getPhoto, subscribe } from './db'

/** 執行查詢，資料庫一有變動就重新查詢 */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>()
  const queryRef = useRef(query)
  queryRef.current = query
  useEffect(() => {
    let alive = true
    const run = () => {
      queryRef.current().then(
        (v) => alive && setValue(v),
        (e) => console.error(e),
      )
    }
    run()
    const unsub = subscribe(run)
    return () => {
      alive = false
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}

/** 把 Blob 轉成可顯示的網址，元件卸載時釋放 */
export function useObjectUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) {
      setUrl(undefined)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** 讀取照片縮圖或顯示版的網址 */
export function usePhotoUrl(id: string | undefined, size: 'thumb' | 'display' = 'thumb'): string | undefined {
  const photo = useLiveQuery(() => (id ? getPhoto(id) : Promise.resolve(undefined)), [id])
  const blob = photo ? (size === 'display' ? (photo.display ?? photo.thumb) : photo.thumb) : null
  return useObjectUrl(blob)
}

// ── 簡易 hash 路由：#/map?d=2026-11-17、#/day/2026-11-17、#/entry/new?d=…、#/entry/<id> ──

export interface Route {
  path: string[]
  query: URLSearchParams
}

function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '')
  const [p, q = ''] = raw.split('?')
  return { path: p ? p.split('/').map(decodeURIComponent) : [], query: new URLSearchParams(q) }
}

let current = parseHash()
const routeListeners = new Set<() => void>()
window.addEventListener('hashchange', () => {
  current = parseHash()
  for (const fn of routeListeners) fn()
})

export function useRoute(): Route {
  return useSyncExternalStore(
    (fn) => {
      routeListeners.add(fn)
      return () => routeListeners.delete(fn)
    },
    () => current,
  )
}

/** App 內往前走了幾頁，用來判斷「返回」要 history.back() 還是直接換頁 */
let depth = 0

export function navigate(to: string, replace = false) {
  const hash = '#/' + to.replace(/^\//, '')
  if (replace) {
    history.replaceState(null, '', hash)
    current = parseHash()
    for (const fn of routeListeners) fn()
  } else {
    depth++
    location.hash = hash
  }
}

/** 返回上一頁；如果是直接打開的頁面就回到 fallback */
export function goBack(fallback: string) {
  if (depth > 0) {
    depth--
    history.back()
  } else {
    navigate(fallback, true)
  }
}
