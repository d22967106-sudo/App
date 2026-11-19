import { currencyInfo } from './currency'
import { buildRoute, dayStats, dayStays } from './day'
import { countPlaces, distanceM } from './geo'
import { shiftDate, sumMoney, totalTwd } from './ledger'
import { eachDate } from './stats'
import { isAuto, usableAutoPoints } from './stays'
import type { DailySteps, Entry, GeoPoint, TrackPoint, Trip } from './types'

/** 旅程每天的顏色（plan.md 定案；超過 5 天循環） */
export const DAY_COLORS = ['#4F7CAC', '#C9733C', '#6E8B5B', '#8A6BA0', '#B8912F']

export function dayColor(i: number): string {
  return DAY_COLORS[i % DAY_COLORS.length]
}

export function tripLength(trip: Pick<Trip, 'start' | 'end'>): number {
  return eachDate(trip.start, trip.end).length
}

/** 2026/11/12 – 11/14（跨年就寫完整年份） */
export function formatTripRange(trip: Pick<Trip, 'start' | 'end'>): string {
  const [sy, sm, sd] = trip.start.split('-').map(Number)
  const [ey, em, ed] = trip.end.split('-').map(Number)
  if (trip.start === trip.end) return `${sy}/${sm}/${sd}`
  return sy === ey ? `${sy}/${sm}/${sd} – ${em}/${ed}` : `${sy}/${sm}/${sd} – ${ey}/${em}/${ed}`
}

// ── 旅程的資料 ──

export interface TripDay {
  date: string
  index: number
  color: string
  title: string
  route: GeoPoint[]
  expense: number
  km: number
  photos: number
  records: number
  steps: number | null
  /** 這天最有代表性的地點（離當天起點最遠、有名字的紀錄），軌跡圖上標地名用 */
  landmark: (GeoPoint & { name: string }) | null
}

export interface TripSummary {
  days: TripDay[]
  expense: number
  km: number
  photos: number
  records: number
  places: number
  steps: number
  /** 外幣支出（原幣合計），例如 [['JPY', 162300]] */
  foreign: [string, number][]
  /** 封面候選（有照片的紀錄裡的照片） */
  photoIds: string[]
}

/** 地名只取最前面那段，例如「祇園 · 京都」→「祇園」 */
function shortName(e: Entry): string | null {
  const area = e.location?.name?.split(' · ')[0]?.trim()
  return area && area !== '未知地點' ? area : e.title.trim() || null
}

export function summarizeTrip(trip: Trip, entries: Entry[], track: TrackPoint[], steps: DailySteps[]): TripSummary {
  const dates = eachDate(trip.start, trip.end)
  const spots: GeoPoint[] = []
  const days = dates.map((date, index): TripDay => {
    const es = entries.filter((e) => e.date === date).sort((a, b) => a.time - b.time)
    const ts = track.filter((t) => t.date === date).sort((a, b) => a.time - b.time)
    const stays = dayStays(ts)
    const st = dayStats(es, ts, stays)
    const route = buildRoute(es, ts)
    spots.push(...stays, ...ts.filter((p) => !isAuto(p)), ...es.flatMap((e) => (e.location ? [e.location] : [])))
    const origin = route[0]
    let landmark: TripDay['landmark'] = null
    let far = -1
    for (const e of es) {
      const name = e.location ? shortName(e) : null
      if (!e.location || !name) continue
      const d = origin ? distanceM(origin, e.location) : 0
      if (d > far) {
        far = d
        landmark = { lat: e.location.lat, lng: e.location.lng, name }
      }
    }
    return {
      date,
      index,
      color: dayColor(index),
      title: trip.dayTitles[index]?.trim() || '',
      route,
      expense: st.expense,
      km: st.km,
      photos: st.photos,
      records: st.records,
      steps: steps.find((s) => s.date === date)?.steps ?? null,
      landmark,
    }
  })
  const foreign = new Map<string, number[]>()
  for (const e of entries) {
    if (e.kind !== 'expense' || e.amount == null || e.currency === 'TWD') continue
    const arr = foreign.get(e.currency) ?? []
    arr.push(e.amount)
    foreign.set(e.currency, arr)
  }
  return {
    days,
    expense: totalTwd(entries, 'expense'),
    km: Math.round(days.reduce((n, d) => n + d.km, 0) * 10) / 10,
    photos: days.reduce((n, d) => n + d.photos, 0),
    records: entries.length,
    places: countPlaces(spots),
    steps: days.reduce((n, d) => n + (d.steps ?? 0), 0),
    foreign: [...foreign.entries()].map(([c, list]) => [c, sumMoney(list)] as [string, number]).sort((a, b) => b[1] - a[1]),
    photoIds: [...entries].sort((a, b) => a.time - b.time).flatMap((e) => e.photoIds),
  }
}

export function foreignText(foreign: [string, number][]): string {
  return foreign
    .slice(0, 2)
    .map(([c, n]) => {
      const info = currencyInfo(c)
      return `${info.name} ${info.symbol}${n.toLocaleString('zh-TW', { maximumFractionDigits: info.digits })}`
    })
    .join('、')
}

// ── 自動建議旅程：離家超過 50 公里的連續幾天 ──

export const AWAY_KM = 50
/** 至少連續幾天才建議（一日遊不算） */
export const MIN_TRIP_DAYS = 2

interface DatedPoint extends GeoPoint {
  date: string
  time: number
}

function datedPoints(entries: Entry[], track: TrackPoint[]): DatedPoint[] {
  const pts: DatedPoint[] = []
  for (const e of entries) if (e.location) pts.push({ lat: e.location.lat, lng: e.location.lng, date: e.date, time: e.time })
  const manual = track.filter((t) => !isAuto(t))
  for (const t of [...manual, ...usableAutoPoints(track)]) pts.push({ lat: t.lat, lng: t.lng, date: t.date, time: t.time })
  return pts
}

/** 家＝最常過夜的地方（每天最早和最晚的位置，約 2 公里一格，取次數最多的那格的平均） */
export function guessHome(entries: Entry[], track: TrackPoint[]): GeoPoint | null {
  const byDate = new Map<string, DatedPoint[]>()
  for (const p of datedPoints(entries, track)) {
    const arr = byDate.get(p.date)
    if (arr) arr.push(p)
    else byDate.set(p.date, [p])
  }
  const cells = new Map<string, GeoPoint[]>()
  for (const list of byDate.values()) {
    list.sort((a, b) => a.time - b.time)
    for (const p of [list[0], list[list.length - 1]]) {
      const key = `${Math.round(p.lat * 50)},${Math.round(p.lng * 50)}`
      const arr = cells.get(key)
      if (arr) arr.push(p)
      else cells.set(key, [p])
    }
  }
  let best: GeoPoint[] = []
  for (const arr of cells.values()) if (arr.length > best.length) best = arr
  if (best.length < 3) return null
  return {
    lat: best.reduce((n, p) => n + p.lat, 0) / best.length,
    lng: best.reduce((n, p) => n + p.lng, 0) / best.length,
  }
}

export interface TripSuggestion {
  start: string
  end: string
  name: string
}

export function suggestionKey(s: Pick<TripSuggestion, 'start' | 'end'>): string {
  return `${s.start}_${s.end}`
}

/** 這幾天最常出現的地名（紀錄的縣市，例如「祇園 · 京都」取「京都」） */
export function guessTripName(entries: Entry[]): string {
  const count = new Map<string, number>()
  for (const e of entries) {
    const parts = e.location?.name?.split(' · ') ?? []
    const city = parts[parts.length - 1]?.trim()
    if (!city || city === '未知地點') continue
    count.set(city, (count.get(city) ?? 0) + 1)
  }
  let name = ''
  let n = 0
  for (const [k, v] of count) if (v > n) [name, n] = [k, v]
  return name.replace(/[市縣]$/, '') || '旅程'
}

export function suggestTrips(
  entries: Entry[],
  track: TrackPoint[],
  trips: Pick<Trip, 'start' | 'end'>[],
  dismissed: string[],
  today: string,
): TripSuggestion[] {
  const home = guessHome(entries, track)
  if (!home) return []
  const far = new Set<string>()
  let last: DatedPoint | null = null
  for (const p of datedPoints(entries, track)) {
    if (!last || p.time > last.time) last = p
    if (far.has(p.date)) continue
    if (distanceM(home, p) > AWAY_KM * 1000) far.add(p.date)
  }
  // 最後一個位置還在外地＝旅程還沒結束，那一段先不建議
  const stillAway = !!last && distanceM(home, last) > AWAY_KM * 1000
  const dates = [...far].sort()
  const groups: string[][] = []
  for (const d of dates) {
    const g = groups[groups.length - 1]
    if (g && shiftDate(g[g.length - 1], 1) === d) g.push(d)
    else groups.push([d])
  }
  if (stillAway && groups.length) groups.pop()
  const out: TripSuggestion[] = []
  for (const g of groups) {
    if (g.length < MIN_TRIP_DAYS) continue
    const s = { start: g[0], end: g[g.length - 1] }
    if (s.end >= today) continue
    if (trips.some((t) => t.start <= s.end && t.end >= s.start)) continue
    if (dismissed.includes(suggestionKey(s))) continue
    out.push({ ...s, name: guessTripName(entries.filter((e) => e.date >= s.start && e.date <= s.end)) })
  }
  return out.reverse()
}
