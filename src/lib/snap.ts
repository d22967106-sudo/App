import { getMeta, setMeta } from './db'
import { distanceM } from './geo'
import type { TravelMode } from './legs'
import type { GeoPoint, TrackPoint } from './types'

/**
 * 貼齊道路：把一段移動的定位點送到 FOSSGIS 的 Valhalla（OpenStreetMap 社群的免費路線伺服器，
 * 不用註冊、不用金鑰；規定每秒最多 1 次、不保證一直可用），用 trace_route 把路線吸附到真正的道路上。
 * 結果存在手機上（同樣的點不再重算）；失敗就回傳 null，畫面上改用原本的直線。
 */

const VALHALLA = 'https://valhalla1.openstreetmap.de/trace_route'

const COSTING: Record<Exclude<TravelMode, 'none'>, string> = {
  scooter: 'motor_scooter',
  car: 'auto',
  walk: 'pedestrian',
  bus: 'bus',
}

/** 一次最多送幾個點（太長就切幾段，網址才不會太長） */
const CHUNK = 250
/** 失敗後多久再試 */
const RETRY_MS = 60 * 60 * 1000

// ── Google encoded polyline（Valhalla 用 6 位小數） ──

export function encodePolyline(points: GeoPoint[], precision = 6): string {
  const f = 10 ** precision
  let lat = 0
  let lng = 0
  let out = ''
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63)
      x >>= 5
    }
    out += String.fromCharCode(x + 63)
  }
  for (const p of points) {
    const a = Math.round(p.lat * f)
    const b = Math.round(p.lng * f)
    enc(a - lat)
    enc(b - lng)
    lat = a
    lng = b
  }
  return out
}

export function decodePolyline(str: string, precision = 6): GeoPoint[] {
  const f = 10 ** precision
  const out: GeoPoint[] = []
  let i = 0
  let lat = 0
  let lng = 0
  const next = () => {
    let shift = 0
    let result = 0
    let b: number
    do {
      b = str.charCodeAt(i++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (i < str.length) {
    lat += next()
    lng += next()
    out.push({ lat: lat / f, lng: lng / f })
  }
  return out
}

// ── 每秒最多 1 次 ──

let queue: Promise<unknown> = Promise.resolve()
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn)
  queue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 1100)))
  return run
}

function hashPoints(points: TrackPoint[]): string {
  let h = 2166136261
  const s = points.map((p) => `${p.time}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36) + points.length
}

type Cached = { pts: [number, number][] } | { failAt: number }

async function requestChunk(points: GeoPoint[], costing: string, fetcher: typeof fetch): Promise<GeoPoint[]> {
  const body = { encoded_polyline: encodePolyline(points), costing, shape_match: 'map_snap' }
  const res = await throttled(() => fetcher(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(body))}`))
  if (!res.ok) throw new Error(`Valhalla ${res.status}`)
  const data = (await res.json()) as { trip?: { legs?: { shape: string }[] } }
  const legs = data.trip?.legs ?? []
  if (!legs.length) throw new Error('Valhalla 沒有回傳路線')
  return legs.flatMap((l) => decodePolyline(l.shape))
}

function lengthM(pts: GeoPoint[]): number {
  let m = 0
  for (let i = 1; i < pts.length; i++) m += distanceM(pts[i - 1], pts[i])
  return m
}

/**
 * 一段移動貼齊道路後的路線；不貼齊（none）、沒網路、失敗或結果不合理（比原本長太多）都回傳 null。
 * fetcher 給測試用。
 */
export async function snapLeg(points: TrackPoint[], mode: TravelMode, fetcher: typeof fetch = fetch): Promise<GeoPoint[] | null> {
  if (mode === 'none' || points.length < 2) return null
  const key = `snap.${mode}.${hashPoints(points)}`
  const hit = await getMeta<Cached>(key)
  if (hit && 'pts' in hit) return hit.pts.map(([lat, lng]) => ({ lat, lng }))
  if (hit && 'failAt' in hit && Date.now() - hit.failAt < RETRY_MS) return null
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  try {
    const out: GeoPoint[] = []
    for (let i = 0; i < points.length - 1; i += CHUNK - 1) {
      const part = await requestChunk(points.slice(i, i + CHUNK), COSTING[mode], fetcher)
      out.push(...(out.length ? part.slice(1) : part))
    }
    // 吸到很遠的路、繞一大圈＝比對錯了，用原本的線
    if (lengthM(out) > lengthM(points) * 2.5 + 500) throw new Error('貼齊後繞太遠')
    await setMeta(key, { pts: out.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]) } satisfies Cached)
    return out
  } catch {
    await setMeta(key, { failAt: Date.now() } satisfies Cached)
    return null
  }
}

// ── 設定 ──

const listeners = new Set<() => void>()
/** 路線設定或手動交通方式改了（設定頁、地圖上的卡片） */
export function onRouteSettingsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const changed = () => listeners.forEach((fn) => fn())

export interface RouteSettings {
  /** 貼齊道路總開關 */
  snap: boolean
  /** 預設交通方式（自動判斷不是走路、也不是火車時用這個） */
  mode: TravelMode
  /** 地圖上顯示背景定位的原始點（除錯：分辨是沒收到還是被過濾掉） */
  rawPoints: boolean
}

export const DEFAULT_ROUTE_SETTINGS: RouteSettings = { snap: true, mode: 'scooter', rawPoints: false }

export async function getRouteSettings(): Promise<RouteSettings> {
  return { ...DEFAULT_ROUTE_SETTINGS, ...((await getMeta<Partial<RouteSettings>>('route.settings')) ?? {}) }
}

export async function saveRouteSettings(s: Partial<RouteSettings>): Promise<void> {
  await setMeta('route.settings', { ...(await getRouteSettings()), ...s })
  changed()
}

/** 手動選的交通方式（key＝日期/段 id） */
export async function getLegModes(): Promise<Record<string, TravelMode>> {
  return (await getMeta<Record<string, TravelMode>>('route.legModes')) ?? {}
}

export async function setLegMode(date: string, legId: string, mode: TravelMode | null): Promise<void> {
  const all = await getLegModes()
  const k = `${date}/${legId}`
  if (mode) all[k] = mode
  else delete all[k]
  await setMeta('route.legModes', all)
  changed()
}
