import { distanceM } from './geo'
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
    const seg = cleanPath(withEnds, LEG_MAX_STEP_M, 15)
    if (seg.length < 2) continue
    const km = pathKm(seg)
    const distinct = distinctStays(g.from, g.to)
    if (km * 1000 < MIN_LEG_M && !distinct) continue
    if (km * 1000 < SHORT_LEG_M && !reallyMoved(raw, g.from, g.to, maxSpeed(seg))) continue
    const hours = (seg[seg.length - 1].time - seg[0].time) / 3600000
    legs.push({
      id: `leg-${seg[0].time}`,
      start: seg[0].time,
      end: seg[seg.length - 1].time,
      points: seg,
      from: g.from,
      to: g.to,
      km: Math.round(km * 10) / 10,
      avgKmh: hours > 0 ? km / hours : 0,
      maxKmh: maxSpeed(seg),
    })
  }
  return legs
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
