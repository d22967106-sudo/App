import { distanceM } from './geo'
import type { GeoPoint, TrackPoint } from './types'

/**
 * 背景定位一天會有上千個點，不能每個都列在時間軸上：
 *   - 路線：去掉精確度太差的點、停著不動時的飄移
 *   - 停留：在 STAY_RADIUS 公尺內待超過 STAY_MIN 分鐘，就是一個「停留」，
 *           時間軸顯示「抵達 ○○」「離開 ○○」（灰色小字）
 */

export const STAY_RADIUS = 150
export const STAY_MIN_MS = 10 * 60 * 1000
/** 精確度比這個差（公尺）的點不用 */
export const MAX_ACCURACY = 100

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

/** 路線用的點：移動距離小於精確度（或 25 公尺）的飄移不算 */
export function cleanPath<T extends GeoPoint & { accuracy?: number }>(points: T[]): T[] {
  const out: T[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || distanceM(last, p) >= Math.max(25, p.accuracy ?? 0, last.accuracy ?? 0)) out.push(p)
  }
  // 最後一個點一定保留（目前位置）
  const tail = points[points.length - 1]
  if (tail && out[out.length - 1] !== tail && out.length) out[out.length - 1] = tail
  return out
}

/** 找出停留：依時間往下看，點都在第一個點附近就算同一段，時間夠長就是停留 */
export function detectStays(points: TrackPoint[], radius = STAY_RADIUS, minMs = STAY_MIN_MS): Stay[] {
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
      if (distanceM(center, pts[j]) > radius) break
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
  return stays
}
