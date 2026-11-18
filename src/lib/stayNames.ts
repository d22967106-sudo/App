import { useEffect, useState } from 'react'
import { getAllPlaces, getMeta, setMeta } from './db'
import { distanceM } from './geo'
import { reverseGeocode } from './geocode'
import type { Stay } from './stays'
import type { Entry, Place } from './types'

/**
 * 停留地點的名稱，依序找：
 *   1. 當天在附近記的帳（記過的店名、或紀錄的地名）
 *   2. 記住去過的店
 *   3. 之前查過的地名（存在手機上）
 *   4. 上網查地名（Nominatim，每秒 1 次）
 */

const NEAR_M = 150
const CACHE_KEY = 'stay.names'

const cellKey = (s: { lat: number; lng: number }) => `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`

export function nameFromLocal(stay: Stay, entries: Entry[], places: Place[]): string | null {
  let best: { name: string; d: number } | null = null
  for (const e of entries) {
    if (!e.location) continue
    const d = distanceM(stay, e.location)
    if (d > NEAR_M) continue
    const name = (e.placeId && e.title.trim()) || e.location.name
    if (name && (!best || d < best.d)) best = { name, d }
  }
  if (best) return best.name
  for (const p of places) {
    const d = distanceM(stay, p)
    if (d <= 100 && (!best || d < best.d)) best = { name: p.name, d }
  }
  return best?.name ?? null
}

export function useStayNames(stays: Stay[], entries: Entry[] | undefined): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({})
  const key = stays.map((s) => s.id).join('|')
  useEffect(() => {
    if (!stays.length || !entries) return
    let alive = true
    ;(async () => {
      const places = await getAllPlaces()
      const cache = (await getMeta<Record<string, string>>(CACHE_KEY)) ?? {}
      const out: Record<string, string> = {}
      const missing: Stay[] = []
      for (const s of stays) {
        const n = nameFromLocal(s, entries, places) ?? cache[cellKey(s)]
        if (n) out[s.id] = n
        else missing.push(s)
      }
      if (alive) setNames({ ...out })
      let changed = false
      for (const s of missing.slice(0, 10)) {
        if (!alive) break
        const r = await reverseGeocode(s)
        if (!r) break
        cache[cellKey(s)] = r.name
        out[s.id] = r.name
        changed = true
        if (alive) setNames({ ...out })
      }
      if (changed) await setMeta(CACHE_KEY, cache)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, entries])
  return names
}
