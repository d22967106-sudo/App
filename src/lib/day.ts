import { countPlaces, routeKm } from './geo'
import { totalTwd } from './ledger'
import { cleanPath, detectStays, isAuto, usableAutoPoints, type Stay } from './stays'
import type { Entry, GeoPoint, TrackPoint } from './types'

export type TimelineItem =
  | { type: 'entry'; time: number; entry: Entry }
  | { type: 'track'; time: number; point: TrackPoint }
  /** 背景定位算出來的「抵達／離開」 */
  | { type: 'stay'; time: number; stay: Stay; edge: 'arrive' | 'leave' }

export interface RoutePoint extends GeoPoint {
  time: number
  ref: { type: 'entry' | 'track'; id: string }
}

/** 當天路線：手動定位點、背景定位點（去掉飄移）與有地點的紀錄，依時間連線 */
export function buildRoute(entries: Entry[], track: TrackPoint[]): RoutePoint[] {
  const pts: RoutePoint[] = []
  for (const t of track) if (!isAuto(t)) pts.push({ lat: t.lat, lng: t.lng, time: t.time, ref: { type: 'track', id: t.id } })
  for (const t of cleanPath(usableAutoPoints(track))) pts.push({ lat: t.lat, lng: t.lng, time: t.time, ref: { type: 'track', id: t.id } })
  for (const e of entries) {
    if (e.location) {
      pts.push({ lat: e.location.lat, lng: e.location.lng, time: e.time, ref: { type: 'entry', id: e.id } })
    }
  }
  return pts.sort((a, b) => a.time - b.time)
}

export function dayStays(track: TrackPoint[]): Stay[] {
  return detectStays(usableAutoPoints(track))
}

export function buildTimeline(entries: Entry[], track: TrackPoint[], stays: Stay[] = dayStays(track)): TimelineItem[] {
  const items: TimelineItem[] = [
    ...entries.map((entry) => ({ type: 'entry' as const, time: entry.time, entry })),
    ...track.filter((p) => !isAuto(p)).map((point) => ({ type: 'track' as const, time: point.time, point })),
  ]
  for (const stay of stays) {
    if (!stay.fromDayStart) items.push({ type: 'stay', time: stay.start, stay, edge: 'arrive' })
    if (!stay.toDayEnd) items.push({ type: 'stay', time: stay.end, stay, edge: 'leave' })
  }
  return items.sort((a, b) => a.time - b.time)
}

export interface DayStats {
  expense: number
  income: number
  places: number
  km: number
  records: number
  photos: number
}

export function dayStats(entries: Entry[], track: TrackPoint[], stays: Stay[] = dayStays(track)): DayStats {
  const route = buildRoute(entries, track)
  // 地點：停留、手動定位、有地點的紀錄（路上經過的點不算）
  const spots: GeoPoint[] = [
    ...stays,
    ...track.filter((p) => !isAuto(p)),
    ...entries.flatMap((e) => (e.location ? [e.location] : [])),
  ]
  return {
    expense: totalTwd(entries, 'expense'),
    income: totalTwd(entries, 'income'),
    places: countPlaces(spots),
    km: routeKm(route),
    records: entries.length,
    photos: entries.reduce((n, e) => n + e.photoIds.length, 0),
  }
}
