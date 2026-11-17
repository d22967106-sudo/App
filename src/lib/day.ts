import { countPlaces, routeKm } from './geo'
import { totalTwd } from './ledger'
import type { Entry, GeoPoint, TrackPoint } from './types'

export type TimelineItem =
  | { type: 'entry'; time: number; entry: Entry }
  | { type: 'track'; time: number; point: TrackPoint }

export interface RoutePoint extends GeoPoint {
  time: number
  ref: { type: 'entry' | 'track'; id: string }
}

/** 當天路線：打卡點與有地點的紀錄，依時間連線 */
export function buildRoute(entries: Entry[], track: TrackPoint[]): RoutePoint[] {
  const pts: RoutePoint[] = []
  for (const t of track) pts.push({ lat: t.lat, lng: t.lng, time: t.time, ref: { type: 'track', id: t.id } })
  for (const e of entries) {
    if (e.location) {
      pts.push({ lat: e.location.lat, lng: e.location.lng, time: e.time, ref: { type: 'entry', id: e.id } })
    }
  }
  return pts.sort((a, b) => a.time - b.time)
}

export function buildTimeline(entries: Entry[], track: TrackPoint[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...entries.map((entry) => ({ type: 'entry' as const, time: entry.time, entry })),
    ...track.map((point) => ({ type: 'track' as const, time: point.time, point })),
  ]
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

export function dayStats(entries: Entry[], track: TrackPoint[]): DayStats {
  const route = buildRoute(entries, track)
  return {
    expense: totalTwd(entries, 'expense'),
    income: totalTwd(entries, 'income'),
    places: countPlaces(route),
    km: routeKm(route),
    records: entries.length,
    photos: entries.reduce((n, e) => n + e.photoIds.length, 0),
  }
}
