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

// ── 繞路修正 ──

/** 貼齊後的線離實際的點超過這麼遠（公尺）＝繞路 */
export const DETOUR_M = 25
/** 兩段繞路中間只隔這麼短（公尺）的正常線，就當成同一段繞路 */
const DETOUR_GAP_M = 30

/** 以 o 為原點的平面座標（公尺），短距離夠準 */
function toXY(o: GeoPoint, p: GeoPoint): [number, number] {
  const k = Math.cos((o.lat * Math.PI) / 180)
  return [((p.lng - o.lng) * Math.PI * 6371008.8 * k) / 180, ((p.lat - o.lat) * Math.PI * 6371008.8) / 180]
}

/** 去程、回程疊在同一條路上時，距離差不到這麼多（公尺）就算在較早的那段 */
const SAME_ROAD_M = 10

/**
 * 點到折線的最近距離，和最近的位置（線段序號＋比例，用來排順序）。
 * 只從 minSeg 段往後找；幾段差不多近（例如迴轉時去回同一條路）就取最早的那段。
 */
function nearestOnLine(o: GeoPoint, line: [number, number][], p: GeoPoint, minSeg = 0, maxSeg = Infinity): { d: number; at: number } {
  const [px, py] = toXY(o, p)
  if (line.length === 1) return { d: Math.hypot(px - line[0][0], py - line[0][1]), at: 0 }
  const cands: { d: number; at: number }[] = []
  for (let i = Math.max(0, minSeg); i < Math.min(line.length - 1, maxSeg + 1); i++) {
    const [ax, ay] = line[i]
    const [bx, by] = line[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    cands.push({ d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), at: i + t })
  }
  if (!cands.length) return { d: Infinity, at: minSeg }
  const min = Math.min(...cands.map((c) => c.d))
  return cands.find((c) => c.d <= min + SAME_ROAD_M)!
}

/**
 * 貼齊道路有時會繞一圈：例如騎過頭在路中間迴轉，路線服務不允許路中迴轉，就繞街區一圈接回來。
 * 貼齊後的線離實際的點超過 DETOUR_M 的那幾段，改成照實際的點畫（直線）。
 */
export function fixDetours(snapped: GeoPoint[], raw: GeoPoint[]): GeoPoint[] {
  if (snapped.length < 3 || raw.length < 2) return snapped
  const o = raw[0]
  const line = raw.map((p) => toXY(o, p))
  // 沿著實際的路線依序對：每個貼齊的點只往後找（離太遠的點不推進位置），
  // 而且最多往前推進「貼齊的線走過的距離 × 1.5 + 100 m」——同一個地方經過兩次（例如繞一圈回到家附近）時，
  // 不會一下子跳到後面那次，把中間整圈當成繞路刪掉（2026-11-21 找停車位繞了一圈不見）
  const cum = [0]
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  const arcAt = (at: number) => {
    const i = Math.min(Math.floor(at), line.length - 1)
    return cum[i] + (i < line.length - 1 ? (at - i) * (cum[i + 1] - cum[i]) : 0)
  }
  let minSeg = 0
  let lastArc = 0
  let traveled = 0
  const near = snapped.map((p, k) => {
    if (k) traveled += distanceM(snapped[k - 1], p)
    const maxArc = lastArc + traveled * 1.5 + 100
    let maxSeg = minSeg
    while (maxSeg + 1 < line.length - 1 && cum[maxSeg + 1] <= maxArc) maxSeg++
    const n = nearestOnLine(o, line, p, minSeg, maxSeg)
    if (n.d <= DETOUR_M) {
      minSeg = Math.floor(n.at)
      lastArc = arcAt(n.at)
      traveled = 0
    }
    return n
  })
  const off = near.map((n) => n.d > DETOUR_M)
  if (!off.some(Boolean)) return snapped
  // 找出繞路的範圍，中間只隔一小段正常線的併成一段
  const runs: [number, number][] = []
  for (let i = 0; i < off.length; i++) {
    if (!off[i]) continue
    let j = i
    while (j + 1 < off.length && off[j + 1]) j++
    const prev = runs[runs.length - 1]
    if (prev) {
      let gap = 0
      for (let k = prev[1]; k < i; k++) gap += distanceM(snapped[k], snapped[k + 1])
      if (gap <= DETOUR_GAP_M) {
        prev[1] = j
        i = j
        continue
      }
    }
    runs.push([i, j])
    i = j
  }
  const out: GeoPoint[] = []
  let k = 0
  for (const [i, j] of runs) {
    const a = Math.max(0, i - 1)
    const b = Math.min(snapped.length - 1, j + 1)
    const from = near[a].at
    const to = near[b].at
    const mid: GeoPoint[] = []
    if (to > from) for (let r = Math.floor(from) + 1; r <= Math.ceil(to) - 1 && r < raw.length; r++) mid.push(raw[r])
    // 只有真的繞一圈才改：貼齊的那段比照實際的點走長 1.5 倍又多 40 m 以上
    // （2026-11-21 實際的例子：迴轉處繞了一個約 50 × 55 m 的小街區）。
    // 點跟點之間本來就是彎路（30 秒一點、騎車時相隔幾百公尺）那種偏離是對的，不能改成直線。
    const snapLen = lengthM(snapped.slice(a, b + 1))
    const rawLen = lengthM([snapped[a], ...mid, snapped[b]])
    if (snapLen <= rawLen * 1.5 + 40) continue
    out.push(...snapped.slice(k, a + 1), ...mid)
    k = b
  }
  out.push(...snapped.slice(k))
  return out
}

/** 尖刺：線在這個點折回去的夾角小於這個（度） */
const SPIKE_DEG = 60
/** …而且這個點離實際路線超過這麼遠（公尺）才拿掉 */
const SPIKE_OFF_M = 10

/**
 * 拿掉尖刺：貼齊後線突然折回去（夾角 < 60°）、而且那個點離實際的點超過 10 m（繞路修掉後剩下的小三角、迴轉時衝過頭的部分）。
 * 一般路口轉彎約 90°，不會被拿掉。頭尾不動。
 */
export function removeSpikes(path: GeoPoint[], raw: GeoPoint[]): GeoPoint[] {
  if (path.length < 3 || raw.length < 2) return path
  const o = raw[0]
  const line = raw.map((p) => toXY(o, p))
  const pts = path.slice()
  for (let changed = true; changed; ) {
    changed = false
    for (let i = 1; i < pts.length - 1; i++) {
      const [ax, ay] = toXY(o, pts[i - 1])
      const [bx, by] = toXY(o, pts[i])
      const [cx, cy] = toXY(o, pts[i + 1])
      const u = [ax - bx, ay - by]
      const v = [cx - bx, cy - by]
      const lu = Math.hypot(u[0], u[1])
      const lv = Math.hypot(v[0], v[1])
      if (lu < 1 || lv < 1) {
        // 重複的點直接拿掉
        pts.splice(i, 1)
        changed = true
        break
      }
      const deg = (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))) * 180) / Math.PI
      if (deg < SPIKE_DEG && nearestOnLine(o, line, pts[i]).d > SPIKE_OFF_M) {
        pts.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return pts
}

/** 貼齊後的整理：先修繞路，再拿掉尖刺 */
export function tidySnapped(snapped: GeoPoint[], raw: GeoPoint[]): GeoPoint[] {
  return removeSpikes(fixDetours(snapped, raw), raw)
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
