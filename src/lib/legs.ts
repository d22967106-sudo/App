import { distanceM } from './geo'
import { formatTime } from './ledger'
import { cleanPath, isAuto, usableAutoPoints, type Stay } from './stays'
import type { GeoPoint, TrackPoint } from './types'

/**
 * 一天的路線依「停留」切成好幾段「移動」（例如家 → 公司、公司 → 拉麵店），
 * 每段可以單獨選、各自的交通方式、各自貼齊道路。
 */

export type TravelMode = 'scooter' | 'car' | 'walk' | 'bus' | 'none'

export const TRAVEL_MODES: { id: TravelMode; name: string }[] = [
  { id: 'scooter', name: '機車' },
  { id: 'car', name: '汽車' },
  { id: 'walk', name: '走路' },
  { id: 'bus', name: '公車' },
  { id: 'none', name: '不貼齊（捷運／火車／高鐵）' },
]

export function modeName(m: TravelMode): string {
  return TRAVEL_MODES.find((x) => x.id === m)?.name.replace(/（.*）/, '') ?? m
}

/** 平均時速低於這個＝走路 */
export const WALK_MAX_KMH = 7
/** 最高時速超過這個＝搭火車／高鐵或走國道，不貼齊 */
export const RAIL_MIN_KMH = 90
/** 移動距離少於這個（公尺）不算一段 */
export const MIN_LEG_M = 80
/** 少於這個距離的段要通過「真的有走開」的檢查（以前一律不算，短距離走路會不見） */
export const SHORT_LEG_M = 200
/** 短的段：最快時速至少要這麼快（走路約 4 km/h；停著時的飄移通常更慢） */
export const SHORT_LEG_MIN_KMH = 2.5
/** 切好的段裡，點和點之間的飄移門檻最多這麼多公尺 */
export const LEG_MAX_STEP_M = 40

export interface Leg {
  /** 用出發時間當 id，同一天重算也不會變（存手動選的交通方式用） */
  id: string
  start: number
  end: number
  /** 這段的點（含前一個停留的最後一點、下一個停留的第一點，接得起來） */
  points: TrackPoint[]
  from: Stay | null
  to: Stay | null
  km: number
  avgKmh: number
  maxKmh: number
  /** 同一段移動中途換交通方式（停車走路、走路去取車）切開時，切點的名稱 */
  fromLabel?: string
  toLabel?: string
  /** 頭／尾是使用者手動切的 */
  cutStart?: boolean
  cutEnd?: boolean
}

function pathKm(pts: GeoPoint[]): number {
  let m = 0
  for (let i = 1; i < pts.length; i++) m += distanceM(pts[i - 1], pts[i])
  return m / 1000
}

/** 最高時速：只看相隔 20 秒以上的兩點（太近的兩點一飄就會算出很快的速度） */
function maxSpeed(pts: TrackPoint[]): number {
  let max = 0
  for (let i = 0; i < pts.length; i++) {
    let j = i + 1
    while (j < pts.length && pts[j].time - pts[i].time < 20000) j++
    if (j >= pts.length) break
    const h = (pts[j].time - pts[i].time) / 3600000
    if (h > 0) max = Math.max(max, distanceM(pts[i], pts[j]) / 1000 / h)
  }
  return max
}

/** 兩個停留的地方相距這麼遠（公尺）以上，中間是一段移動（各自都待滿 10 分鐘） */
export const DISTINCT_STAYS_M = 60
/** …而且從前一個停留到下一個停留，換算時速至少這麼快（慢慢飄移一小時 60 m 的不算） */
export const DISTINCT_MIN_KMH = 0.5

function distinctStays(from: Stay | null, to: Stay | null): boolean {
  if (!from || !to) return false
  const m = distanceM(from, to)
  const h = Math.max(1, to.start - from.end) / 3600000
  return m >= DISTINCT_STAYS_M && m / 1000 / h >= DISTINCT_MIN_KMH
}

/**
 * 短的段是真的走開了，還是停著時的飄移：
 * - 從一個停留走到另一個停留，兩地相距 60 m 以上、而且不是慢慢飄過去的＝真的移動（例如家 → 90 m 外的早餐店）
 * - 否則（走出去又回到同一個地方、或還在路上）：有一個點離出發／抵達的地方至少 60 m、而且超過那個點精確度的 1.5 倍，
 *   且有走路以上的速度
 */
function reallyMoved(raw: TrackPoint[], from: Stay | null, to: Stay | null, maxKmh: number): boolean {
  if (distinctStays(from, to)) return true
  if (maxKmh < SHORT_LEG_MIN_KMH) return false
  const anchors: GeoPoint[] = [from, to].filter((s): s is Stay => !!s)
  if (!anchors.length && raw.length) anchors.push(raw[0])
  return raw.some((p) => anchors.every((a) => distanceM(a, p) >= Math.max(60, (p.accuracy ?? 0) * 1.5)))
}

/** 點離前後兩點連線至少偏這麼多（公尺）才可能是飄移（貼在線上的點留著，貼齊道路才有足夠的點） */
const WOBBLE_MIN_M = 5
/** 飄移最多算到這麼遠（公尺）；偏更遠的一定留著 */
const WOBBLE_MAX_M = 25

/** 點到線段的距離（公尺，短距離平面近似） */
function offsetFromChord(a: GeoPoint, p: GeoPoint, b: GeoPoint): number {
  const k = Math.cos((p.lat * Math.PI) / 180) * 111320
  const ax = (a.lng - p.lng) * k
  const ay = (a.lat - p.lat) * 111320
  const bx = (b.lng - p.lng) * k
  const by = (b.lat - p.lat) * 111320
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2)) : 0
  return Math.hypot(ax + t * dx, ay + t * dy)
}

/**
 * 畫線時跳過飄移的點：離前後兩點連線偏 5 m 以上、但沒超過它自己的精確度（最多 25 m）
 * ＝在誤差範圍內，多半是定位飄掉（2026-11-21 走路回家，兩個點跑到中港路對面，誤差圈剛好跨過馬路）。
 * 轉彎、迴轉的點偏離很遠，不會被跳過；頭尾不動。原始定位點本身不改，只是不拿來畫線。
 */
export function dropWobble(pts: TrackPoint[]): TrackPoint[] {
  const ok = (p: TrackPoint, a: TrackPoint, b: TrackPoint, min: number) => {
    if (p.accuracy == null) return false
    const off = offsetFromChord(a, p, b)
    return off >= min && off <= Math.min(p.accuracy, WOBBLE_MAX_M)
  }
  // 留下的點（原本的序號）；跳過一個點時，之前跳過、夾在中間的點也都要還在新連線的誤差範圍內，
  // 才不會連續跳點把真的轉角一點一點削掉
  let keep = pts.map((_, i) => i)
  for (;;) {
    let best = -1
    let bestRatio = Infinity
    for (let k = 1; k < keep.length - 1; k++) {
      const a = pts[keep[k - 1]]
      const p = pts[keep[k]]
      const b = pts[keep[k + 1]]
      if (!ok(p, a, b, WOBBLE_MIN_M)) continue
      let fine = true
      for (let j = keep[k - 1] + 1; j < keep[k + 1] && fine; j++) if (j !== keep[k]) fine = ok(pts[j], a, b, 0)
      if (!fine) continue
      const ratio = offsetFromChord(a, p, b) / p.accuracy!
      if (ratio < bestRatio) {
        bestRatio = ratio
        best = k
      }
    }
    if (best < 0) return keep.map((i) => pts[i])
    keep = keep.filter((_, k) => k !== best)
  }
}

/** 超過這麼久沒收到點＝定位中斷（Overland 被關掉、沒電…），在那裡切開 */
export const NO_DATA_MS = 20 * 60 * 1000

/**
 * 中斷前後相距超過這麼遠（公尺）才算「中間有移動但沒記到」。
 * 待在家時 iPhone 會暫停定位，出門後要移動幾百公尺才恢復，第一個點本來就離家一段距離，那種照舊接起來；
 * 2026-11-24 關掉 Overland 那次，恢復時已經離住宿 4.8 km。
 */
export const NO_DATA_MOVE_M = 2000

/** 相鄰兩點相隔超過 NO_DATA_MS、而且位置差超過 NO_DATA_MOVE_M 就切開 */
export function splitAtNoData(pts: TrackPoint[]): TrackPoint[][] {
  const out: TrackPoint[][] = []
  let cur: TrackPoint[] = []
  for (const p of pts) {
    const last = cur[cur.length - 1]
    if (last && p.time - last.time > NO_DATA_MS && distanceM(last, p) > NO_DATA_MOVE_M) {
      out.push(cur)
      cur = []
    }
    cur.push(p)
  }
  if (cur.length) out.push(cur)
  return out
}

/** 停留的中心當成一個點（移動段從上一個停留的中心畫到下一個停留的中心） */
function stayPoint(s: Stay, time: number, date: string): TrackPoint {
  return { id: `${s.id}-c${time}`, time, date, lat: s.lat, lng: s.lng, source: 'auto' }
}

export function computeLegs(track: TrackPoint[], stays: Stay[]): Leg[] {
  const pts = usableAutoPoints(track)
  if (pts.length < 2) return []
  const sorted = [...stays].sort((a, b) => a.start - b.start)
  // 停留之間的空檔就是移動
  const gaps: { from: Stay | null; to: Stay | null; t0: number; t1: number }[] = []
  let prev: Stay | null = null
  let t = pts[0].time
  for (const s of sorted) {
    if (s.start > t) gaps.push({ from: prev, to: s, t0: t, t1: s.start })
    prev = s
    t = s.end
  }
  if (t < pts[pts.length - 1].time) gaps.push({ from: prev, to: null, t0: t, t1: pts[pts.length - 1].time })

  const legs: Leg[] = []
  for (const g of gaps) {
    const raw = pts.filter((p) => p.time >= g.t0 && p.time <= g.t1)
    // 停留的範圍常常把走路中的點也吃進去（停留半徑 50 m 起跳），短距離走路中間會只剩一兩個點，
    // 所以頭尾接上停留的中心：從哪裡出發、到了哪裡，線一定接得起來
    const date = raw[0]?.date ?? pts[0].date
    const withEnds = [...(g.from ? [stayPoint(g.from, g.t0, date)] : []), ...raw.filter((p) => !(g.from && p.time === g.t0) && !(g.to && p.time === g.t1)), ...(g.to ? [stayPoint(g.to, g.t1, date)] : [])]
    const whole = dropWobble(cleanPath(withEnds, LEG_MAX_STEP_M, 15))
    // 定位中斷（超過 NO_DATA_MS 沒收到點，例如 Overland 被關掉）就切開，中間不畫線、不算時間：
    // 2026-11-24 使用者中途關掉 Overland，04:36 住宿到 10:35 已在路上被接成一段，貼齊道路補出一段沒走過的路
    const pieces = splitAtNoData(whole)
    pieces.forEach((seg, pi) => {
    const from = pi === 0 ? g.from : null
    const to = pi === pieces.length - 1 ? g.to : null
    if (seg.length < 2) return
    const km = pathKm(seg)
    const distinct = distinctStays(from, to)
    if (km * 1000 < MIN_LEG_M && !distinct) return
    if (km * 1000 < SHORT_LEG_M && !reallyMoved(raw.filter((p) => p.time >= seg[0].time && p.time <= seg[seg.length - 1].time), from, to, maxSpeed(seg))) return
    const parts = splitByMode(seg)
    parts.forEach((part, k) => {
      const pk = pathKm(part.points)
      const hours = (part.points[part.points.length - 1].time - part.points[0].time) / 3600000
      legs.push({
        id: `leg-${part.points[0].time}`,
        start: part.points[0].time,
        end: part.points[part.points.length - 1].time,
        points: part.points,
        from: k === 0 ? from : null,
        to: k === parts.length - 1 ? to : null,
        km: Math.round(pk * 10) / 10,
        avgKmh: hours > 0 ? pk / hours : 0,
        maxKmh: maxSpeed(part.points),
        ...(k > 0 ? { fromLabel: parts[k - 1].walk ? '取車處' : '停車處' } : pi > 0 ? { fromLabel: '定位中斷後' } : {}),
        ...(k < parts.length - 1 ? { toLabel: part.walk ? '取車處' : '停車處' } : pi < pieces.length - 1 ? { toLabel: '定位中斷' } : {}),
      })
    })
    })
  }
  return legs
}

/**
 * 使用者手動切段（2026-11-22 使用者要求：自己選一個原始點到另一個原始點，那一段單獨選交通方式）。
 * cuts 是切點的時間（毫秒）；每個切點找這段裡時間最近的點（相差 2 分鐘內、不是頭尾）切開，切點兩段共用。
 */
export function applyCuts(legs: Leg[], cuts: number[]): Leg[] {
  if (!cuts.length) return legs
  const out: Leg[] = []
  for (const leg of legs) {
    const pts = leg.points
    const idx = new Set<number>()
    for (const c of cuts) {
      if (c <= leg.start || c >= leg.end) continue
      let best = -1
      let bd = Infinity
      for (let i = 1; i < pts.length - 1; i++) {
        const d = Math.abs(pts[i].time - c)
        if (d < bd) {
          bd = d
          best = i
        }
      }
      if (best > 0 && bd <= 120000) idx.add(best)
    }
    if (!idx.size) {
      out.push(leg)
      continue
    }
    const at = [0, ...[...idx].sort((a, b) => a - b), pts.length - 1]
    for (let k = 0; k < at.length - 1; k++) {
      const part = pts.slice(at[k], at[k + 1] + 1)
      const pk = pathKm(part)
      const hours = (part[part.length - 1].time - part[0].time) / 3600000
      const first = k === 0
      const last = k === at.length - 2
      out.push({
        id: `leg-${part[0].time}`,
        start: part[0].time,
        end: part[part.length - 1].time,
        points: part,
        from: first ? leg.from : null,
        to: last ? leg.to : null,
        km: Math.round(pk * 10) / 10,
        avgKmh: hours > 0 ? pk / hours : 0,
        maxKmh: maxSpeed(part),
        cutStart: !first || leg.cutStart,
        cutEnd: !last || leg.cutEnd,
        ...(first ? (leg.fromLabel ? { fromLabel: leg.fromLabel } : {}) : { fromLabel: formatTime(part[0].time) }),
        ...(last ? (leg.toLabel ? { toLabel: leg.toLabel } : {}) : { toLabel: formatTime(part[part.length - 1].time) }),
      })
    }
  }
  return out
}

/** 走路速度（km/h）以下 */
const SPLIT_WALK_KMH = 7
/** 騎車速度（km/h）以上 */
const SPLIT_RIDE_KMH = 15
/** 兩點相隔超過這麼久（秒）不拿來判斷（中間可能停著等） */
const SPLIT_MAX_GAP_S = 90

/**
 * 同一段移動中途換交通方式（例如騎車找停車位、停好走路回家）就切開。
 * 走路的部分要：連續至少 3 個間隔是走路速度、合計 ≥ 90 秒、≥ 60 m，而且這段其他地方有騎車速度。
 * 只看一兩個點不夠：騎車在巷子裡轉彎時兩點之間的直線速度會很慢（2026-11-21 23:25 家附近）。
 */
export function splitByMode(seg: TrackPoint[]): { points: TrackPoint[]; walk: boolean }[] {
  const n = seg.length
  if (n < 5) return [{ points: seg, walk: false }]
  // 每個間隔：S＝走路速度、F＝騎車速度、N＝停著或相隔太久（不影響）、M＝中間
  const kind: ('S' | 'F' | 'N' | 'M')[] = []
  const dist: number[] = []
  for (let i = 1; i < n; i++) {
    const d = distanceM(seg[i - 1], seg[i])
    const dt = (seg[i].time - seg[i - 1].time) / 1000
    dist.push(d)
    const v = dt > 0 ? (d / dt) * 3.6 : 0
    if (dt > SPLIT_MAX_GAP_S || d < 3) kind.push('N')
    else if (v < SPLIT_WALK_KMH) kind.push('S')
    else if (v >= SPLIT_RIDE_KMH) kind.push('F')
    else kind.push('M')
  }
  if (!kind.includes('F')) return [{ points: seg, walk: false }]
  // 找走路的區間（只由 S、N 組成）
  const walks: [number, number][] = []
  for (let i = 0; i < kind.length; i++) {
    if (kind[i] !== 'S') continue
    let j = i
    while (j + 1 < kind.length && (kind[j + 1] === 'S' || kind[j + 1] === 'N')) j++
    while (j > i && kind[j] === 'N') j--
    let count = 0
    let m = 0
    for (let k = i; k <= j; k++) if (kind[k] === 'S') (count++, (m += dist[k]))
    const secs = (seg[j + 1].time - seg[i].time) / 1000
    if (count >= 3 && secs >= 90 && m >= 60) walks.push([i, j + 1])
    i = j
  }
  if (!walks.length) return [{ points: seg, walk: false }]
  // 依切點分成騎車／走路幾段（切點的點兩段共用，線接得起來）
  const out: { points: TrackPoint[]; walk: boolean }[] = []
  let at = 0
  for (const [a, b] of walks) {
    if (a > at) out.push({ points: seg.slice(at, a + 1), walk: false })
    out.push({ points: seg.slice(a, b + 1), walk: true })
    at = b
  }
  if (at < n - 1) out.push({ points: seg.slice(at), walk: false })
  return out.filter((p) => p.points.length >= 2)
}

/** 最快也不超過這個時速＝走路（點少的短段平均時速會被誤差灌高，例如兩點 34 秒 80 m 算成 8.6 km/h） */
export const WALK_TOP_KMH = 12
/** 平均很慢但最快超過這個＝騎車中間有等（停紅燈、到了還沒算停留），不是走路 */
export const RIDE_MIN_TOP_KMH = 25

/** 依速度猜交通方式：很慢＝走路；很快＝火車／高鐵（不貼齊）；其他＝預設 */
export function guessMode(leg: Pick<Leg, 'avgKmh' | 'maxKmh'>, fallback: TravelMode): TravelMode {
  if (leg.maxKmh > RAIL_MIN_KMH) return 'none'
  if (leg.maxKmh < WALK_TOP_KMH) return 'walk'
  if (leg.avgKmh < WALK_MAX_KMH && leg.maxKmh < RIDE_MIN_TOP_KMH) return 'walk'
  return fallback
}

/**
 * 接上前一天的最後位置：今天 0 點時人就在前一天最後的位置。
 * 回傳一個不存檔的「延續點」（時間＝今天 0 點），放在今天的軌跡最前面。
 */
export function carryPoint(date: string, before: TrackPoint[]): TrackPoint | null {
  const last = usableAutoPoints(before.filter((p) => p.date < date)).at(-1)
  if (!last) return null
  const [y, m, d] = date.split('-').map(Number)
  return {
    id: `carry-${date}`,
    time: new Date(y, m - 1, d).getTime(),
    date,
    lat: last.lat,
    lng: last.lng,
    accuracy: last.accuracy,
    source: 'auto',
    carriedFrom: last.time,
  }
}

/** 今天的軌跡加上延續點（今天已經有比 0 點更早的點就不用） */
export function withCarry(track: TrackPoint[], carry: TrackPoint | null): TrackPoint[] {
  if (!carry) return track
  return [carry, ...track]
}

export const isCarry = (p: TrackPoint) => p.carriedFrom != null

export { isAuto }
