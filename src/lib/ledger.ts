import type { Entry } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

/** 以當地時區取得 YYYY-MM-DD */
export function toDateKey(d: Date | number): string {
  const dt = typeof d === 'number' ? new Date(d) : d
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

export function parseDateKey(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function isDateKey(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && toDateKey(parseDateKey(s)) === s
}

export function shiftDate(date: string, delta: number): string {
  const d = parseDateKey(date)
  return toDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta))
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 11月17日 星期二 */
export function formatDateLong(date: string): string {
  const d = parseDateKey(date)
  return `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAYS[d.getDay()]}`
}

/** 今天／昨天／明天，其餘回傳年份或空字串 */
export function relativeDayLabel(date: string, today = toDateKey(new Date())): string {
  if (date === today) return '今天'
  if (date === shiftDate(today, -1)) return '昨天'
  if (date === shiftDate(today, 1)) return '明天'
  const y = date.slice(0, 4)
  return y === today.slice(0, 4) ? '' : `${y} 年`
}

/** HH:mm */
export function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 給 <input type="datetime-local"> 用：YYYY-MM-DDTHH:mm */
export function toDateTimeLocal(ms: number): string {
  return `${toDateKey(ms)}T${formatTime(ms)}`
}

export function fromDateTimeLocal(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number)
  const t = new Date(y, mo - 1, d, h, mi).getTime()
  return Number.isNaN(t) ? null : t
}

/** 10月4日 15:20 */
export function formatDateTimeShort(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${formatTime(ms)}`
}

const toCents = (n: number) => Math.round(n * 100)

/** 以「分」為單位運算，避免浮點誤差 */
export function roundMoney(n: number): number {
  return toCents(n) / 100
}

export function sumMoney(values: number[]): number {
  return values.reduce((acc, v) => acc + toCents(v), 0) / 100
}

export function totalTwd(entries: Entry[], kind: 'expense' | 'income'): number {
  return sumMoney(
    entries.filter((e) => e.kind === kind && e.amountTwd != null).map((e) => e.amountTwd as number),
  )
}

/** 解析使用者輸入的金額（最多兩位小數，可以是 0）；不合法回傳 null */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return n >= 0 && n <= 1e10 ? n : null
}

/** 依時間排序（舊到新） */
export function byTime<T extends { time: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.time - b.time)
}

/** 金額輸入框：輸入時自動加千分位逗號，最多兩位小數（例：1450.5 → 1,450.5） */
export function formatAmountInput(input: string): string {
  let s = input.replace(/[^\d.]/g, '')
  const dot = s.indexOf('.')
  let dec: string | null = null
  if (dot >= 0) {
    dec = s.slice(dot + 1).replace(/\./g, '').slice(0, 2)
    s = s.slice(0, dot)
  }
  s = s.replace(/^0+(?=\d)/, '')
  const int = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  if (dec === null) return int
  return `${int || '0'}.${dec}`
}
