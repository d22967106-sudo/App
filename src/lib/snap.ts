import { getMeta, setMeta } from './db'
import { distanceM } from './geo'
import type { TravelMode } from './legs'
import type { GeoPoint, TrackPoint } from './types'

/**
 * 貼齊道路：把一段移動的定位點送到 FOSSGIS 的 Valhalla（OpenStreetMap 社群的免費路線伺服器，
 * 不用註冊、不用金鑰；規定每秒最多 1 次、不保證一直可用），用 trace_route 把路線吸附到真正的道路上。
 * 結果存在手機上（同樣的點不再重算）；失敗就回傳 null，畫面上改用原本的直線。
 */

const VALHALLA_BASE = 'https://valhalla1.openstreetmap.de'

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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function medianAccuracy(points: TrackPoint[]): number {
  const a = points.map((p) => p.accuracy).filter((x): x is number => x != null).sort((x, y) => x - y)
  return a.length ? a[Math.floor(a.length / 2)] : 20
}

async function valhalla(endpoint: 'trace_route' | 'route', body: unknown, fetcher: typeof fetch): Promise<GeoPoint[]> {
  const res = await throttled(() => fetcher(`${VALHALLA_BASE}/${endpoint}?json=${encodeURIComponent(JSON.stringify(body))}`))
  if (!res.ok) throw new Error(`Valhalla ${res.status}`)
  const data = (await res.json()) as { trip?: { legs?: { shape: string }[] } }
  const legs = data.trip?.legs ?? []
  if (!legs.length) throw new Error('Valhalla 沒有回傳路線')
  return legs.flatMap((l, i) => {
    const pts = decodePolyline(l.shape)
    return i ? pts.slice(1) : pts
  })
}

/**
 * 比對（map matching）：把點的實際精確度告訴 Valhalla（預設以為 GPS 很準，±30～65 m 的走路點常常比對失敗），
 * 也附上每點的時間間隔。官方文件：點最好 1～10 秒一個、search_radius 最大 100 m；走路來回抖可以加 turn_penalty_factor 500。
 */
async function traceChunk(points: TrackPoint[], costing: string, fetcher: typeof fetch): Promise<GeoPoint[]> {
  const acc = medianAccuracy(points)
  const trace_options: Record<string, number> = {
    gps_accuracy: clamp(Math.round(acc), 5, 100),
    search_radius: clamp(Math.round(acc * 1.5), 30, 100),
  }
  if (costing === 'pedestrian' && acc > 20) trace_options.turn_penalty_factor = 500
  const body = {
    encoded_polyline: encodePolyline(points),
    costing,
    shape_match: 'map_snap',
    begin_time: Math.round(points[0].time / 1000),
    durations: points.slice(1).map((p, i) => Math.max(0, Math.round((p.time - points[i].time) / 1000))),
    trace_options,
  }
  return valhalla('trace_route', body, fetcher)
}

/** 規劃路線時最多用幾個點（Valhalla 公共伺服器的地點數有上限，保守用 20） */
const ROUTE_MAX_LOCATIONS = 20

/** 平均挑出最多 n 個點（一定留頭尾） */
export function thin<T>(points: T[], n: number): T[] {
  if (points.length <= n) return points
  const out: T[] = []
  for (let k = 0; k < n; k++) out.push(points[Math.round((k * (points.length - 1)) / (n - 1))])
  return out
}

/**
 * 比對失敗時的備案：把點當成「途經點」沿著道路規劃路線（點很稀疏、誤差大時比對做不到，規劃路線可以）。
 * 中間的點用 via（可以迴轉、不分段），走去巷口再走回來也畫得出來。
 */
async function routeThrough(points: TrackPoint[], costing: string, fetcher: typeof fetch): Promise<GeoPoint[]> {
  const pick = thin(points, ROUTE_MAX_LOCATIONS)
  const locations = pick.map((p, i) => ({
    lat: Math.round(p.lat * 1e6) / 1e6,
    lon: Math.round(p.lng * 1e6) / 1e6,
    type: i === 0 || i === pick.length - 1 ? 'break' : 'via',
  }))
  return valhalla('route', { locations, costing }, fetcher)
}

async function requestChunk(points: TrackPoint[], costing: string, fetcher: typeof fetch): Promise<GeoPoint[]> {
  try {
    return await traceChunk(points, costing, fetcher)
  } catch {
    return await routeThrough(points, costing, fetcher)
  }
}

// ── 貼齊後對回實際的點 ──
//
// 原則（2026-11-21 使用者定的）：實際收到的定位點是事實，路線一定要經過每一個點、一個都不能丟；
// 貼齊道路只用來補「兩個點之間怎麼走」。所以：
//   1. 依序找每個點在貼齊線上的位置（離線不超過容許距離才算經過）
//   2. 相鄰兩個點之間，貼齊線那一段長度合理才用；太長（繞街區，例如路中迴轉不被允許）就直線連過去
//   3. 貼齊線沒經過的點，直線連過去
// 以前的做法（先貼齊、再找繞路、拿尖刺）會把真的點丟在路線外，已經拿掉。

/** 點要離貼齊線多近才算「線經過它」：精確度的 1.5 倍，夾在 20～50 m */
const passTol = (acc?: number) => clamp((acc ?? 20) * 1.5, 20, 50)
/** 兩個點之間的貼齊線最多可以比直線長多少：× 1.4 或多 40 m，取大的 */
const maxBetween = (straight: number) => Math.max(straight * 1.4, straight + 40)

/** 迴轉：前後兩段方向夾角超過這個（度）＝下一個點跑到上一個點後面 */
const UTURN_DEG = 135
/** 迴轉點前後的貼齊線要很接近直線才用（路線服務不允許路中迴轉，常常繞街區接回來） */
const maxAtUturn = (straight: number) => straight * 1.15 + 15

/** 以 o 為原點的平面座標（公尺），短距離夠準 */
function toXY(o: GeoPoint, p: GeoPoint): [number, number] {
  const k = Math.cos((o.lat * Math.PI) / 180)
  return [((p.lng - o.lng) * Math.PI * 6371008.8 * k) / 180, ((p.lat - o.lat) * Math.PI * 6371008.8) / 180]
}

/**
 * 路線一定經過每個實際的點；點和點之間能用貼齊道路的線就用，不合理就直線。
 * raw：這段移動的實際定位點（依時間）。snapped：貼齊道路服務回來的線。
 */
export function alignToRaw(snapped: GeoPoint[], raw: (GeoPoint & { accuracy?: number; time?: number })[]): GeoPoint[] {
  if (raw.length < 2) return raw.slice()
  if (snapped.length < 2) return raw.slice()
  const o = raw[0]
  const S = snapped.map((p) => toXY(o, p))
  const cum = [0]
  for (let i = 1; i < S.length; i++) cum.push(cum[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]))
  const arcAt = (at: number) => {
    const i = Math.min(Math.floor(at), S.length - 1)
    return i >= S.length - 1 ? cum[S.length - 1] : cum[i] + (at - i) * (cum[i + 1] - cum[i])
  }
  const pointAt = (at: number): GeoPoint => {
    const i = Math.min(Math.floor(at), S.length - 2)
    const t = Math.max(0, Math.min(1, at - i))
    return { lat: snapped[i].lat + (snapped[i + 1].lat - snapped[i].lat) * t, lng: snapped[i].lng + (snapped[i + 1].lng - snapped[i].lng) * t }
  }
  /** 線段 i 上離 p 最近的位置 */
  const onSeg = (i: number, px: number, py: number) => {
    const [ax, ay] = S[i]
    const [bx, by] = S[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), at: i + t }
  }

  // 1. 依序找每個點在貼齊線上的位置；只往後找，而且最多往前「跟上一點的直線距離 × 3 + 150 m」
  //    （同一個地方經過兩次時不會跳到後面那次）
  const pos: (number | null)[] = []
  let at = 0
  for (let r = 0; r < raw.length; r++) {
    const [px, py] = toXY(o, raw[r])
    const tol = passTol(raw[r].accuracy)
    const limit = arcAt(at) + (r ? distanceM(raw[r - 1], raw[r]) * 3 : 0) + 150
    let found: { d: number; at: number } | null = null
    for (let i = Math.floor(at); i < S.length - 1 && cum[i] <= limit; i++) {
      const c = onSeg(i, px, py)
      if (c.at < at) continue
      if (c.d <= tol) {
        // 找到第一段經過的，再往後看相連的幾段取最近的位置
        found = c
        for (let j = i + 1; j < S.length - 1; j++) {
          const n = onSeg(j, px, py)
          if (n.d > tol) break
          if (n.d < found.d) found = n
        }
        break
      }
    }
    pos.push(found ? found.at : null)
    if (found) at = found.at
  }

  // 迴轉點：下一個點跑到上一個點後面（前後兩段方向夾角 > 135°，使用者提的判斷）
  const uturn = raw.map((p, r) => {
    if (r === 0 || r === raw.length - 1) return false
    const [ax, ay] = toXY(o, raw[r - 1])
    const [bx, by] = toXY(o, p)
    const [cx, cy] = toXY(o, raw[r + 1])
    const u = [bx - ax, by - ay]
    const v = [cx - bx, cy - by]
    const lu = Math.hypot(u[0], u[1])
    const lv = Math.hypot(v[0], v[1])
    if (lu < 5 || lv < 5) return false
    const deg = (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))) * 180) / Math.PI
    return deg > UTURN_DEG
  })

  // 2. 接起來：
  //    - 每個點都在路線上：貼齊線經過它（在它的誤差範圍內）就畫在路上的那個位置
  //      （點本來就有 5～20 m 誤差，硬畫在點的正中心會一下拐出去一下拐回來，2026-11-22 使用者回報「直線往返多出突出的折線」）；
  //      貼齊線沒經過的點照原本的位置畫
  //    - 相鄰兩點之間：貼齊線的長度在「這段時間照當下速度走得到的距離」內就用
  //      （30 秒一點，騎車時兩點之間可能繞進巷子，不能只看比直線長幾倍）；
  //      迴轉點前後要很接近直線才用，不然照實際的點折返
  const speed = raw.map((p, r) => (r ? distanceM(raw[r - 1], p) / Math.max(1, (p.time ?? 0) - (raw[r - 1].time ?? 0)) * 1000 : 0))
  const at0 = (r: number) => (pos[r] != null ? pointAt(pos[r]!) : raw[r])
  const out: GeoPoint[] = [at0(0)]
  for (let r = 1; r < raw.length; r++) {
    const a = pos[r - 1]
    const b = pos[r]
    if (a != null && b != null && b > a) {
      const len = arcAt(b) - arcAt(a)
      const straight = distanceM(raw[r - 1], raw[r])
      const t0 = raw[r - 1].time
      const t1 = raw[r].time
      // 這段時間照前後的速度（取快的、再寬鬆 1.3 倍）走得到多遠
      const v = Math.max(speed[r] || 0, speed[r + 1] || 0, speed[r - 1] || 0)
      const reach = t0 != null && t1 != null ? ((t1 - t0) / 1000) * v * 1.3 : 0
      const limit = uturn[r - 1] || uturn[r] ? maxAtUturn(straight) : Math.max(maxBetween(straight), reach)
      if (len <= limit) for (let i = Math.floor(a) + 1; i < b && i < snapped.length; i++) out.push(snapped[i])
    }
    out.push(at0(r))
  }
  return out
}

/** 貼齊後的整理：路線經過每個實際的點，點之間能貼齊就貼齊 */
export function tidySnapped(snapped: GeoPoint[], raw: (GeoPoint & { accuracy?: number; time?: number })[]): GeoPoint[] {
  return alignToRaw(snapped, raw)
}

function lengthM(pts: GeoPoint[]): number {
  let m = 0
  for (let i = 1; i < pts.length; i++) m += distanceM(pts[i - 1], pts[i])
  return m
}

/** 除錯：這段移動存在手機上的「貼齊服務原始回傳」（還沒對回實際的點），沒有就 null */
export async function getSnapCache(points: TrackPoint[], mode: TravelMode): Promise<GeoPoint[] | null> {
  if (mode === 'none' || points.length < 2) return null
  const hit = await getMeta<Cached>(`snap2.${mode}.${hashPoints(points)}`)
  return hit && 'pts' in hit ? hit.pts.map(([lat, lng]) => ({ lat, lng })) : null
}

/**
 * 一段移動貼齊道路後的路線；不貼齊（none）、沒網路、失敗或結果不合理（比原本長太多）都回傳 null。
 * fetcher 給測試用。
 */
export async function snapLeg(points: TrackPoint[], mode: TravelMode, fetcher: typeof fetch = fetch): Promise<GeoPoint[] | null> {
  if (mode === 'none' || points.length < 2) return null
  // snap2：改了比對方式（2026-11-21），以前失敗的結果要重試
  const key = `snap2.${mode}.${hashPoints(points)}`
  const hit = await getMeta<Cached>(key)
  if (hit && 'pts' in hit) return tidySnapped(hit.pts.map(([lat, lng]) => ({ lat, lng })), points)
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
    return tidySnapped(out, points)
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
