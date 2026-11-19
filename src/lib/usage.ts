/** 使用狀況的計算（免費方案的上限與「照這個速度還能用幾年」） */

export const DB_LIMIT = 500 * 1024 * 1024
export const PHOTO_LIMIT = 10 * 1024 * 1024 * 1024
/** 資料少於幾天就不估算 */
export const MIN_DAYS_FOR_ESTIMATE = 14

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

/**
 * 照現在的速度還能用幾年：
 * grown＝這段期間長出來的大小（不含資料庫本身的固定開銷），days＝從第一筆資料到今天幾天。
 * 資料太少回傳 null；超過 99 年回傳 99。
 */
export function yearsLeft(used: number, limit: number, grown: number, days: number): number | null {
  if (days < MIN_DAYS_FOR_ESTIMATE || grown <= 0) return null
  const perDay = grown / days
  const left = Math.max(limit - used, 0) / perDay / 365
  return Math.min(Math.round(left * 10) / 10, 99)
}

export function yearsText(y: number | null): string {
  if (y == null) return `資料還太少（不到 ${MIN_DAYS_FOR_ESTIMATE} 天），之後再估`
  if (y >= 99) return '照現在的速度，可以用超過 99 年'
  if (y < 1) return `照現在的速度，大約 ${Math.max(1, Math.round(y * 12))} 個月後會滿`
  return `照現在的速度，還能用約 ${y >= 10 ? Math.round(y) : y} 年`
}
