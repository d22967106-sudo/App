import type { Transaction } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

/** 以當地時區取得 YYYY-MM-DD */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM */
export function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  return toMonthKey(new Date(y, m - 1 + delta, 1))
}

export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y} 年 ${m} 月`
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function formatDayHeader(date: string, today = toDateKey(new Date())): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const nextDay = toDateKey(new Date(y, m - 1, d + 1))
  const label = `${m}/${d}（${WEEKDAYS[dt.getDay()]}）`
  if (date === today) return `今天 · ${label}`
  if (nextDay === today) return `昨天 · ${label}`
  return label
}

const moneyFmt = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 })

export function formatMoney(n: number): string {
  return `$${moneyFmt.format(n)}`
}

const toCents = (n: number) => Math.round(n * 100)

/** 以「分」為單位加總，避免浮點誤差 */
function sumAmounts(list: Transaction[]): number {
  return list.reduce((acc, t) => acc + toCents(t.amount), 0) / 100
}

export function inMonth(list: Transaction[], month: string): Transaction[] {
  return list.filter((t) => t.date.startsWith(month + '-'))
}

export interface Summary {
  income: number
  expense: number
  balance: number
}

export function summarize(list: Transaction[]): Summary {
  const income = sumAmounts(list.filter((t) => t.type === 'income'))
  const expense = sumAmounts(list.filter((t) => t.type === 'expense'))
  return { income, expense, balance: (toCents(income) - toCents(expense)) / 100 }
}

export interface DayGroup {
  date: string
  items: Transaction[]
  summary: Summary
}

/** 依日期分組，新的在前；同日內依建立時間新到舊 */
export function groupByDay(list: Transaction[]): DayGroup[] {
  const map = new Map<string, Transaction[]>()
  for (const t of list) {
    const arr = map.get(t.date)
    if (arr) arr.push(t)
    else map.set(t.date, [t])
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, items]) => {
      const sorted = [...items].sort((a, b) => b.createdAt - a.createdAt)
      return { date, items: sorted, summary: summarize(sorted) }
    })
}

export interface CategoryTotal {
  categoryId: string
  total: number
  ratio: number
}

/** 支出依分類加總，金額大到小 */
export function expenseByCategory(list: Transaction[]): CategoryTotal[] {
  const map = new Map<string, number>()
  let totalCents = 0
  for (const t of list) {
    if (t.type !== 'expense') continue
    const c = toCents(t.amount)
    totalCents += c
    map.set(t.categoryId, (map.get(t.categoryId) ?? 0) + c)
  }
  return [...map.entries()]
    .map(([categoryId, cents]) => ({
      categoryId,
      total: cents / 100,
      ratio: totalCents ? cents / totalCents : 0,
    }))
    .sort((a, b) => b.total - a.total)
}

/** 解析使用者輸入的金額（最多兩位小數）；不合法回傳 null */
export function parseAmount(input: string): number | null {
  const s = input.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return n > 0 && n <= 1e10 ? n : null
}
