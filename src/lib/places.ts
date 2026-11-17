import { getAllPlaces, newId, putPlace } from './db'
import { distanceM } from './geo'
import type { Entry, GeoPoint, Place } from './types'

/** 同名且在 SAME_PLACE_M 公尺內視為同一家店 */
const SAME_PLACE_M = 150

export interface PlaceSuggestion {
  place: Place
  distance: number
}

/** 附近記過的店，去過次數多、距離近的排前面 */
export function rankPlaces(places: Place[], at: GeoPoint, radius = 300): PlaceSuggestion[] {
  return places
    .map((place) => ({ place, distance: Math.round(distanceM(at, place)) }))
    .filter((s) => s.distance <= radius)
    .sort((a, b) => b.place.visits - a.place.visits || a.distance - b.distance)
}

export async function suggestPlaces(at: GeoPoint): Promise<PlaceSuggestion[]> {
  return rankPlaces(await getAllPlaces(), at)
}

/** 最常出現的金額；次數一樣取最近一次 */
export function commonAmount(amounts: number[]): number | null {
  if (!amounts.length) return null
  const count = new Map<number, number>()
  for (const a of amounts) count.set(a, (count.get(a) ?? 0) + 1)
  let best = amounts[amounts.length - 1]
  let bestN = 0
  for (let i = amounts.length - 1; i >= 0; i--) {
    const n = count.get(amounts[i]) ?? 0
    if (n > bestN) {
      best = amounts[i]
      bestN = n
    }
  }
  return best
}

export function findSamePlace(places: Place[], name: string, at: GeoPoint): Place | undefined {
  const key = name.trim()
  return places.find((p) => p.name === key && distanceM(p, at) <= SAME_PLACE_M)
}

/** 存檔時記住這家店；回傳 place id（沒有店名或地點則回傳 null） */
export async function rememberPlace(entry: Entry): Promise<string | null> {
  const name = entry.title.trim()
  if (!name || !entry.location || entry.kind === 'diary') return null
  const places = await getAllPlaces()
  const existing =
    (entry.placeId && places.find((p) => p.id === entry.placeId && p.name === name)) ||
    findSamePlace(places, name, entry.location)
  const amounts = entry.amount != null ? [entry.amount] : []
  // 編輯同一筆紀錄時不重複計算來訪次數與金額
  const isNewVisit = !existing || entry.placeId !== existing.id
  const place: Place = existing
    ? {
        ...existing,
        categoryId: entry.categoryId ?? existing.categoryId,
        currency: entry.currency,
        recentAmounts: isNewVisit ? [...existing.recentAmounts, ...amounts].slice(-10) : existing.recentAmounts,
        visits: existing.visits + (isNewVisit ? 1 : 0),
        lastVisit: Math.max(existing.lastVisit, entry.time),
      }
    : {
        id: newId(),
        name,
        lat: entry.location.lat,
        lng: entry.location.lng,
        categoryId: entry.categoryId,
        recentAmounts: amounts,
        currency: entry.currency,
        visits: 1,
        lastVisit: entry.time,
      }
  await putPlace(place)
  return place.id
}
