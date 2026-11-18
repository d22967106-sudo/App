import { getCategory } from './categories'
import { formatCurrency, formatNumber, formatTwd } from './currency'
import type { Entry } from './types'

export function entryTitle(e: Entry): string {
  if (e.title.trim()) return e.title.trim()
  if (e.kind === 'diary') return e.location?.name ?? '隨手記'
  return getCategory(e.categoryId)?.name ?? (e.kind === 'income' ? '收入' : '支出')
}

export function entrySubtitle(e: Entry): string {
  const note = e.note.trim().split('\n')[0]
  if (note) return note
  if (e.kind === 'diary') return e.photoIds.length ? `${e.photoIds.length} 張照片` : '隨手記'
  return e.photoIds.length ? `${e.photoIds.length} 張照片` : '只有記帳'
}

/** 列表用的短金額：-65、+500；外幣顯示原幣 */
export function shortAmount(e: Entry): { main: string; twd?: string } | null {
  if (e.amount == null || e.kind === 'diary') return null
  const sign = e.amount === 0 ? '' : e.kind === 'income' ? '+' : '-'
  if (e.currency === 'TWD') return { main: `${sign}${formatNumber(e.amount)}` }
  return {
    main: `${sign}${formatCurrency(e.amount, e.currency)}`,
    twd: e.amountTwd != null ? `≈ ${formatTwd(e.amountTwd)}` : undefined,
  }
}

/** 完整回顧用的金額：-NT$65 */
export function longAmount(e: Entry): { main: string; twd?: string } | null {
  if (e.amount == null || e.kind === 'diary') return null
  const sign = e.amount === 0 ? '' : e.kind === 'income' ? '+' : '-'
  const main = `${sign}${formatCurrency(e.amount, e.currency)}`
  if (e.currency === 'TWD') return { main }
  return { main, twd: e.amountTwd != null ? `≈ ${formatTwd(e.amountTwd)}` : undefined }
}
