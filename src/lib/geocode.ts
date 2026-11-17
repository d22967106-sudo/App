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

/** 免費的公共 Overpass 伺服器（店名搜尋的最後備案）；第一台忙碌或沒回應就換下一台 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

export interface ShopResult {
  /** 是否有服務成功回應（false＝網路或服務問題，不是「附近沒店」） */
  ok: boolean
  shops: NearbyShop[]
  /** 失敗原因（給使用者截圖回報用），例如「overpass-api.de：逾時」 */
  errors?: string[]
}

/** 有逾時的 fetch（不用 AbortSignal.any，舊版 iOS 也能用） */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number, outer?: AbortSignal): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(new DOMException('timeout', 'TimeoutError')), ms)
  const onOuter = () => ctl.abort(outer?.reason)
  outer?.addEventListener('abort', onOuter)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
}

function describeError(host: string, e: unknown, res?: Response): string {
  if (res) return `${host}：HTTP ${res.status}`
  const name = (e as Error)?.name
  if (name === 'AbortError' || name === 'TimeoutError') return `${host}：逾時`
  return `${host}：連不上`
}

async function runOverpass(query: string, center: GeoPoint, signal?: AbortSignal, ms = 12000): Promise<ShopResult> {
  const errors: string[] = []
  for (const url of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) break
    const host = new URL(url).hostname
    try {
      const res = await fetchWithTimeout(url, { method: 'POST', body: new URLSearchParams({ data: query }) }, ms, signal)
      if (!res.ok) {
        errors.push(describeError(host, null, res))
        continue
      }
      return { ok: true, shops: parseOverpass(await res.json(), center) }
    } catch (e) {
      errors.push(describeError(host, e))
    }
  }
  return { ok: false, shops: [], errors }
}

const POI_FILTER = '[~"^(amenity|shop|tourism|leisure|craft|office)$"~"."]'

/** 把使用者輸入轉成安全的 Overpass 正規表示式（不分大小寫） */
export function overpassNameRegex(text: string): string {
  return text
    .trim()
    .replace(/[\\.*+?^${}()|[\]"]/g, (c) => (c === '"' ? '' : `\\\\${c}`))
    .replace(/\s+/g, '.*')
}

/** 名字搜尋結果：去掉太遠、沒名字、重複的，近的排前面（連鎖店的不同分店都會留著） */
export function finishSearch(list: NearbyShop[], center: GeoPoint, radius: number): NearbyShop[] {
  const seen = new Set<string>()
  return list
    .map((s) => ({ ...s, distance: Math.round(distanceM(center, s)) }))
    .filter((s) => s.name && s.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .filter((s) => {
      // 同名且在 50 公尺內視為同一家（OSM 有時同一家店會有點和建築物兩筆）
      const key = `${s.name}@${Math.round(s.lat * 2000)},${Math.round(s.lng * 2000)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 25)
}

/** 方形搜尋範圍（給 Nominatim viewbox 用）：左,上,右,下 */
export function viewbox(p: GeoPoint, radius: number): string {
  const dLat = radius / 111320
  const dLng = radius / (111320 * Math.cos((p.lat * Math.PI) / 180))
  return [p.lng - dLng, p.lat + dLat, p.lng + dLng, p.lat - dLat].map((n) => n.toFixed(5)).join(',')
}

export function parseNominatimSearch(json: unknown, center: GeoPoint): NearbyShop[] {
  const out: NearbyShop[] = []
  for (const raw of (Array.isArray(json) ? json : []) as Record<string, unknown>[]) {
    const lat = Number(raw.lat)
    const lng = Number(raw.lon)
    const name = String(raw.name || '').trim()
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const cls = String(raw.category ?? raw.class ?? '')
    const type = String(raw.type ?? '')
    if (/^(highway|boundary|place|landuse|natural|waterway|railway)$/.test(cls) && cls !== 'railway') continue
    out.push({
      osmId: `${raw.osm_type}/${raw.osm_id}`,
      name,
      lat,
      lng,
      distance: Math.round(distanceM(center, { lat, lng })),
      categoryId: guessCategoryFromOsm({ [cls]: type }),
      kindLabel: KIND_LABEL[type] ?? '',
    })
  }
  return out
}

export function parsePhotonSearch(json: unknown, center: GeoPoint): NearbyShop[] {
  const out: NearbyShop[] = []
  const features = ((json as { features?: unknown[] })?.features ?? []) as {
    geometry?: { coordinates?: [number, number] }
    properties?: Record<string, string>
  }[]
  for (const f of features) {
    const [lng, lat] = f.geometry?.coordinates ?? []
    const p = f.properties ?? {}
    const name = (p.name || '').trim()
    if (!name || lat == null || lng == null) continue
    if (/^(highway|boundary|place|landuse|natural|waterway)$/.test(p.osm_key ?? '')) continue
    out.push({
      osmId: `${p.osm_type ?? ''}/${p.osm_id ?? ''}`,
      name,
      lat,
      lng,
      distance: Math.round(distanceM(center, { lat, lng })),
      categoryId: guessCategoryFromOsm(p.osm_key ? { [p.osm_key]: p.osm_value ?? '' } : {}),
      kindLabel: KIND_LABEL[p.osm_value ?? ''] ?? '',
    })
  }
  return out
}

/**
 * 用店名搜尋附近（預設 30 公里內，近的排前面；回家才記帳也找得到剛剛去的店）。
 * 依序試：Nominatim（OSM 官方搜尋）→ Photon（另一個 OSM 搜尋）→ Overpass
 */
export async function searchShops(p: GeoPoint, text: string, radius = 30000, signal?: AbortSignal): Promise<ShopResult> {
  const q = text.trim()
  if (!q) return { ok: true, shops: [] }
  const errors: string[] = []
  let anyOk = false

  // 1. Nominatim：限定在附近的方形範圍內（同一家連鎖店會有很多間，近的排前面）
  try {
    await nominatimThrottle()
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=40&bounded=1&addressdetails=0` +
      `&accept-language=zh-TW,zh,en&viewbox=${viewbox(p, radius)}&q=${encodeURIComponent(q)}`
    const res = await fetchWithTimeout(url, {}, 8000, signal)
    if (res.ok) {
      anyOk = true
      const shops = finishSearch(parseNominatimSearch(await res.json(), p), p, radius)
      if (shops.length) return { ok: true, shops }
    } else errors.push(describeError('nominatim', null, res))
  } catch (e) {
    errors.push(describeError('nominatim', e))
  }

  // 2. Photon：以目前位置為中心找，再濾掉太遠的
  try {
    const url = `https://photon.komoot.io/api/?limit=30&lat=${p.lat}&lon=${p.lng}&q=${encodeURIComponent(q)}`
    const res = await fetchWithTimeout(url, {}, 8000, signal)
    if (res.ok) {
      anyOk = true
      const shops = finishSearch(parsePhotonSearch(await res.json(), p), p, radius)
      if (shops.length) return { ok: true, shops }
    } else errors.push(describeError('photon', null, res))
  } catch (e) {
    errors.push(describeError('photon', e))
  }

  // 3. Overpass：最慢，最後才用；範圍太大會逾時，最多查 8 公里
  const re = overpassNameRegex(q)
  const opRadius = Math.min(radius, 8000)
  const query =
    `[out:json][timeout:20];(` +
    `nwr(around:${opRadius},${p.lat},${p.lng})["name"~"${re}",i]${POI_FILTER};` +
    `nwr(around:${opRadius},${p.lat},${p.lng})["name:zh"~"${re}",i]${POI_FILTER};` +
    `);out center 40;`
  const r = await runOverpass(query, p, signal, 15000)
  if (r.ok) return { ok: true, shops: finishSearch(r.shops, p, radius) }
  return { ok: anyOk, shops: [], errors: [...errors, ...(r.errors ?? [])] }
}
