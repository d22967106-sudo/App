import { distanceM } from './geo'
import type { GeoPoint, TrackPoint } from './types'

/**
 * 背景定位一天會有上千個點，不能每個都列在時間軸上：
 *   - 路線：去掉精確度太差的點、停著不動時的飄移
 *   - 停留：在 STAY_RADIUS 公尺內待超過 STAY_MIN 分鐘，就是一個「停留」，
 *           時間軸顯示「抵達 ○○」「離開 ○○」（灰色小字）
 */

/** 停留半徑上限（精確度很差的點用這個，避免飄移被當成出門） */
export const STAY_RADIUS = 150
/** 停留半徑下限：GPS 很準時，離開這麼遠就算出門（走去巷口買東西也抓得到） */
export const STAY_RADIUS_MIN = 50
/** 每個點自己的停留半徑：精確度的 1.5 倍，夾在 50～150 公尺 */
export const stayRadiusFor = (accuracy?: number) => Math.min(STAY_RADIUS, Math.max(STAY_RADIUS_MIN, (accuracy ?? STAY_RADIUS) * 1.5))
export const STAY_MIN_MS = 10 * 60 * 1000
/** 精確度比這個差（公尺）的點不用 */
export const MAX_ACCURACY = 200

export interface Stay extends GeoPoint {
  id: string
  start: number
  end: number
  /** 這段停留是當天第一個點就開始（不顯示「抵達」） */
  fromDayStart: boolean
  /** 停到當天最後一個點（不顯示「離開」） */
  toDayEnd: boolean
}

export const isAuto = (p: TrackPoint) => p.source === 'auto'

/** 可用的自動軌跡點（依時間排序） */
export function usableAutoPoints(track: TrackPoint[]): TrackPoint[] {
  return track.filter((p) => isAuto(p) && (p.accuracy == null || p.accuracy <= MAX_ACCURACY)).sort((a, b) => a.time - b.time)
}

/**
 * 路線用的點：移動距離小於精確度（或 25 公尺）的飄移不算。
 * maxStep：門檻最多到這麼多公尺（切好的移動段用，走路時點的精確度常常 ±30～65 m，照精確度丟會把整段走路丟光）
 */
export function cleanPath<T extends GeoPoint & { accuracy?: number }>(points: T[], maxStep = Infinity, minStep = 25): T[] {
  const out: T[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || distanceM(last, p) >= Math.min(maxStep, Math.max(minStep, p.accuracy ?? 0, last.accuracy ?? 0))) out.push(p)
  }
  // 最後一個點一定保留（目前位置）
  const tail = points[points.length - 1]
  if (tail && out[out.length - 1] !== tail && out.length) out[out.length - 1] = tail
  return out
}

/**
 * 找出停留：依時間往下看，點都在中心附近就算同一段，時間夠長就是停留。
 * 「附近」看每個點的精確度（stayRadiusFor）：準的點離開 50 m 就算走開，不準的點放寬到 150 m。
 * 給 radius 就固定用那個半徑（舊行為）。
 */
export function detectStays(points: TrackPoint[], radius?: number, minMs = STAY_MIN_MS): Stay[] {
  const pts = points.slice().sort((a, b) => a.time - b.time)
  const stays: Stay[] = []
  let i = 0
  while (i < pts.length) {
    let latSum = pts[i].lat
    let lngSum = pts[i].lng
    let n = 1
    let j = i + 1
    while (j < pts.length) {
      const center = { lat: latSum / n, lng: lngSum / n }
      if (distanceM(center, pts[j]) > (radius ?? stayRadiusFor(pts[j].accuracy))) break
      latSum += pts[j].lat
      lngSum += pts[j].lng
      n++
      j++
    }
    const start = pts[i].time
    const end = pts[j - 1].time
    if (end - start >= minMs) {
      stays.push({
        id: `stay-${start}`,
        lat: latSum / n,
        lng: lngSum / n,
        start,
        end,
        fromDayStart: i === 0,
        toDayEnd: j === pts.length,
      })
      i = j
    } else i++
  }
  return radius != null ? stays : mergeSameSpot(stays, pts)
}

/**
 * 同一個地方被一個飄出去的點切成兩段停留時，合回一段：
 * 兩段中心很近，而且中間走遠的點（離中心超過 stayRadiusFor(精確度) 的 1.2 倍且至少 60 m）少於兩個。
 * 真的走去巷口再回來，中間會有走遠的點，不會被合併。
 */
function mergeSameSpot(stays: Stay[], pts: TrackPoint[]): Stay[] {
  const out: Stay[] = []
  for (const s of stays) {
    const prev = out[out.length - 1]
    if (prev && distanceM(prev, s) <= STAY_RADIUS_MIN) {
      const between = pts.filter((p) => p.time > prev.end && p.time < s.start)
      // 只有一個點飄出去＝飄移（真的走開，30 秒一點至少會有兩個點在外面）
      const wandered = between.filter((p) => distanceM(prev, p) > Math.max(60, stayRadiusFor(p.accuracy) * 1.2)).length >= 2
      if (!wandered) {
        out[out.length - 1] = { ...prev, end: s.end, toDayEnd: s.toDayEnd }
        continue
      }
    }
    out.push(s)
  }
  return out
}
