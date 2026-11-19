import { CATEGORIES } from './categories'
import { countPlaces } from './geo'
import { dayStats, dayStays } from './day'
import { parseDateKey, shiftDate, sumMoney, toDateKey, totalTwd } from './ledger'
import { isAuto } from './stays'
import type { DailySteps, DailySummary, Entry, GeoPoint, TrackPoint } from './types'

/** 這個月有幾天（month＝YYYY-MM） */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function monthRange(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` }
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 這個月第一天是星期幾（0＝星期日） */
export function firstWeekday(month: string): number {
  return parseDateKey(`${month}-01`).getDay()
}

/** 日期範圍裡的每一天（含頭尾） */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end; d = shiftDate(d, 1)) out.push(d)
  return out
}

function groupByDate<T extends { date: string }>(list: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const x of list) {
    const arr = map.get(x.date)
    if (arr) arr.push(x)
    else map.set(x.date, [x])
  }
  return map
}

// ── 日曆 ──

export interface CalendarDay {
  date: string
  expense: number
  income: number
  /** 第一張照片（日曆上顯示小縮圖） */
  photoId: string | null
  /** 有日記內容（紀錄的日記或每日總結） */
  hasDiary: boolean
  records: number
}

export function calendarDays(month: string, entries: Entry[], summaries: DailySummary[]): Map<string, CalendarDay> {
  const byDate = groupByDate(entries)
  const sums = new Map(summaries.map((s) => [s.date, s]))
  const out = new Map<string, CalendarDay>()
  const { start, end } = monthRange(month)
  for (const date of eachDate(start, end)) {
    const list = (byDate.get(date) ?? []).sort((a, b) => a.time - b.time)
    const summary = sums.get(date)
    const photoId = list.find((e) => e.photoIds.length)?.photoIds[0] ?? null
    const hasDiary = list.some((e) => e.note.trim()) || !!summary?.text.trim()
    if (!list.length && !hasDiary) continue
    out.set(date, {
      date,
      expense: totalTwd(list, 'expense'),
      income: totalTwd(list, 'income'),
      photoId,
      hasDiary,
      records: list.length,
    })
  }
  return out
}

// ── 統計 ──

export interface CategoryTotal {
  id: string
  name: string
  amount: number
  count: number
}

export function categoryTotals(entries: Entry[], kind: 'expense' | 'income' = 'expense'): CategoryTotal[] {
  const map = new Map<string, { amount: number[]; count: number }>()
  for (const e of entries) {
    if (e.kind !== kind || e.amountTwd == null) continue
    const id = e.categoryId ?? 'other'
    const cur = map.get(id) ?? { amount: [], count: 0 }
    cur.amount.push(e.amountTwd)
    cur.count++
    map.set(id, cur)
  }
  return [...map.entries()]
    .map(([id, v]) => {
      const cat = CATEGORIES.find((c) => c.id === id)
      return { id, name: cat?.name ?? '其他', amount: sumMoney(v.amount), count: v.count }
    })
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}

/** 依時間單位加總支出：月→每天，年→每月 */
export function expenseSeries(entries: Entry[], keys: string[], keyOf: (e: Entry) => string): number[] {
  const map = new Map<string, number[]>()
  for (const e of entries) {
    if (e.kind !== 'expense' || e.amountTwd == null) continue
    const k = keyOf(e)
    const arr = map.get(k)
    if (arr) arr.push(e.amountTwd)
    else map.set(k, [e.amountTwd])
  }
  return keys.map((k) => sumMoney(map.get(k) ?? []))
}

export interface LifeStats {
  /** 有步數紀錄的日子的平均 */
  avgSteps: number | null
  km: number
  places: number
  photos: number
}

/** 步數平均、移動距離、地點數、照片數（照片數算紀錄上的照片） */
export function lifeStats(entries: Entry[], track: TrackPoint[], steps: DailySteps[]): LifeStats {
  const entriesByDate = groupByDate(entries)
  const trackByDate = groupByDate(track)
  const dates = new Set([...entriesByDate.keys(), ...trackByDate.keys()])
  let km = 0
  const spots: GeoPoint[] = []
  for (const date of dates) {
    const es = entriesByDate.get(date) ?? []
    const ts = (trackByDate.get(date) ?? []).sort((a, b) => a.time - b.time)
    const stays = dayStays(ts)
    km += dayStats(es, ts, stays).km
    spots.push(...stays, ...ts.filter((p) => !isAuto(p)), ...es.flatMap((e) => (e.location ? [e.location] : [])))
  }
  const withSteps = steps.filter((s) => s.steps > 0)
  return {
    avgSteps: withSteps.length ? Math.round(withSteps.reduce((n, s) => n + s.steps, 0) / withSteps.length) : null,
    km: Math.round(km * 10) / 10,
    places: countPlaces(spots),
    photos: entries.reduce((n, e) => n + e.photoIds.length, 0),
  }
}

/**
 * 跟上一期比較：看的是本月（還沒過完）就比上個月的同一段日期，否則比整個上個月。
 * 回傳 [上一期金額, 比較的天數（null＝整個月）]
 */
export function comparePeriod(month: string, today = toDateKey(new Date())): { prevMonth: string; untilDay: number | null } {
  const prevMonth = shiftMonth(month, -1)
  if (today.slice(0, 7) !== month) return { prevMonth, untilDay: null }
  const day = Number(today.slice(8, 10))
  return { prevMonth, untilDay: Math.min(day, daysInMonth(prevMonth)) }
}

export function sumExpenseUntil(entries: Entry[], untilDay: number | null): number {
  const list = untilDay == null ? entries : entries.filter((e) => Number(e.date.slice(8, 10)) <= untilDay)
  return totalTwd(list, 'expense')
}

