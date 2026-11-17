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

/** 免費的公共 Overpass 伺服器；第一台忙碌或沒回應就換下一台 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

export interface ShopResult {
  /** 是否有伺服器成功回應（false＝網路或服務問題，不是「附近沒店」） */
  ok: boolean
  shops: NearbyShop[]
}

async function runOverpass(query: string, center: GeoPoint, signal?: AbortSignal): Promise<ShopResult> {
  for (const url of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) break
    try {
      const timeout = AbortSignal.timeout(9000)
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
      if (!res.ok) continue
      return { ok: true, shops: parseOverpass(await res.json(), center) }
    } catch {
      /* 換下一台 */
    }
  }
  return { ok: false, shops: [] }
}

const POI_FILTER = '[~"^(amenity|shop|tourism|leisure|craft|office)$"~"."]'

/** 附近有名字的店家、景點 */
export function nearbyShops(p: GeoPoint, radius = 200, signal?: AbortSignal): Promise<ShopResult> {
  const q = `[out:json][timeout:8];nwr(around:${radius},${p.lat},${p.lng})[name]${POI_FILTER};out center 80;`
  return runOverpass(q, p, signal)
}

/** 把使用者輸入轉成安全的 Overpass 正規表示式（不分大小寫） */
export function overpassNameRegex(text: string): string {
  return text
    .trim()
    .replace(/[\\.*+?^${}()|[\]"]/g, (c) => (c === '"' ? '' : `\\\\${c}`))
    .replace(/\s+/g, '.*')
}

/** 用店名搜尋附近（預設 2 公里） */
export function searchShops(p: GeoPoint, text: string, radius = 2000, signal?: AbortSignal): Promise<ShopResult> {
  const re = overpassNameRegex(text)
  if (!re) return Promise.resolve({ ok: true, shops: [] })
  const q =
    `[out:json][timeout:10];(` +
    `nwr(around:${radius},${p.lat},${p.lng})["name"~"${re}",i]${POI_FILTER};` +
    `nwr(around:${radius},${p.lat},${p.lng})["name:zh"~"${re}",i]${POI_FILTER};` +
    `);out center 40;`
  return runOverpass(q, p, signal)
}
