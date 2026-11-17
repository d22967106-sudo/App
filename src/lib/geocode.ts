import { guessCategoryFromOsm } from './categories'
import { distanceM } from './geo'
import type { GeoPoint } from './types'

export interface ReverseResult {
  /** 「祇園 · 京都」這種短地名 */
  name: string
  countryCode?: string
}

const reverseCache = new Map<string, ReverseResult>()
let lastNominatim = 0

/** Nominatim 使用規範：每秒最多 1 次請求 */
async function nominatimThrottle() {
  const wait = lastNominatim + 1100 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastNominatim = Date.now()
}

export function shortPlaceName(address: Record<string, string>): string {
  const area =
    address.neighbourhood ||
    address.quarter ||
    address.suburb ||
    address.city_district ||
    address.village ||
    address.hamlet ||
    ''
  const city = address.city || address.town || address.county || address.state || ''
  const parts = [area, city].filter(Boolean)
  const uniq = parts.filter((p, i) => parts.indexOf(p) === i)
  return uniq.join(' · ') || address.country || '未知地點'
}

/** 座標 → 地名（離線或失敗時回傳 null） */
export async function reverseGeocode(p: GeoPoint, signal?: AbortSignal): Promise<ReverseResult | null> {
  const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
  const hit = reverseCache.get(key)
  if (hit) return hit
  try {
    await nominatimThrottle()
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&addressdetails=1` +
      `&accept-language=zh-TW,zh,en&lat=${p.lat}&lon=${p.lng}`
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const data = (await res.json()) as { address?: Record<string, string> }
    if (!data.address) return null
    const result = {
      name: shortPlaceName(data.address),
      countryCode: data.address.country_code?.toLowerCase(),
    }
    reverseCache.set(key, result)
    return result
  } catch {
    return null
  }
}

export interface NearbyShop {
  osmId: string
  name: string
  lat: number
  lng: number
  distance: number
  categoryId: string | null
  kindLabel: string
}

const KIND_LABEL: Record<string, string> = {
  restaurant: '餐廳', cafe: '咖啡廳', fast_food: '速食', bar: '酒吧', pub: '酒吧', food_court: '美食街',
  ice_cream: '冰品', convenience: '便利商店', supermarket: '超市', bakery: '麵包店', hotel: '飯店',
  hostel: '青年旅館', guest_house: '民宿', museum: '博物館', attraction: '景點', pharmacy: '藥局',
  cinema: '電影院', clothes: '服飾', books: '書店', department_store: '百貨', mall: '購物中心',
  place_of_worship: '寺廟／教堂', station: '車站', parking: '停車場', fuel: '加油站',
}

export function parseOverpass(json: unknown, center: GeoPoint, limit = 25): NearbyShop[] {
  const elements = (json as { elements?: unknown[] })?.elements ?? []
  const out: NearbyShop[] = []
  const seen = new Set<string>()
  for (const raw of elements) {
    const el = raw as {
      type: string
      id: number
      lat?: number
      lon?: number
      center?: { lat: number; lon: number }
      tags?: Record<string, string>
    }
    const tags = el.tags ?? {}
    const name = tags['name:zh-Hant'] || tags['name:zh-TW'] || tags.name
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon
    if (!name || lat == null || lng == null) continue
    if (seen.has(name)) continue
    seen.add(name)
    const kind = tags.amenity || tags.shop || tags.tourism || tags.leisure || tags.railway || ''
    out.push({
      osmId: `${el.type}/${el.id}`,
      name,
      lat,
      lng,
      distance: Math.round(distanceM(center, { lat, lng })),
      categoryId: guessCategoryFromOsm(tags),
      kindLabel: KIND_LABEL[kind] ?? '',
    })
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, limit)
}

/** 用 Overpass 查附近店家（失敗回傳空陣列） */
export async function nearbyShops(p: GeoPoint, radius = 150, signal?: AbortSignal): Promise<NearbyShop[]> {
  const q =
    `[out:json][timeout:10];` +
    `nwr(around:${radius},${p.lat},${p.lng})[name][~"^(amenity|shop|tourism|leisure)$"~"."];` +
    `out center 60;`
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: new URLSearchParams({ data: q }),
      signal,
    })
    if (!res.ok) return []
    return parseOverpass(await res.json(), p)
  } catch {
    return []
  }
}
