import { getMeta, setMeta } from './db'

/**
 * 本機設定備份／還原（2026-11-24）：只存在這支手機、沒有同步到雲端、全部資料備份也沒包含的設定。
 * 用途：iPhone 主畫面的網頁 App 刪掉重新加入時（例如換圖示），它存在手機上的資料可能會一起被清掉，
 * 先匯出這個檔案，重新加入後匯入，就不用重新設定雲端、自動化金鑰、路線修改。
 */
export const LOCAL_SETTINGS_FORMAT = 'koukou-local-settings'
export const LOCAL_SETTINGS_VERSION = 1

/** 要備份的設定（meta 的 key） */
export const LOCAL_KEYS = [
  'cloud.config', // 雲端（資料庫、照片伺服器）網址
  'cloud.session', // 登入狀態
  'cloud.settings', // 照片暫存上限、暫停上傳
  'auto.key', // 自動化金鑰（雲端只存雜湊，沒了要重新產生）
  'auto.budget', // 小工具的每月預算
  'route.settings', // 路線設定
  'route.legModes', // 手動選的交通方式
  'route.legEdits', // 手繪修改的路線
  'route.legCuts', // 手動切段
  'mapStyle', // 地圖樣式
  'lastCurrency', // 上次用的幣別
] as const

export interface LocalSettingsFile {
  format: typeof LOCAL_SETTINGS_FORMAT
  version: number
  exportedAt: string
  meta: Record<string, unknown>
}

export async function buildLocalSettings(): Promise<LocalSettingsFile> {
  const meta: Record<string, unknown> = {}
  for (const k of LOCAL_KEYS) {
    const v = await getMeta<unknown>(k)
    if (v !== undefined && v !== null) meta[k] = v
  }
  return { format: LOCAL_SETTINGS_FORMAT, version: LOCAL_SETTINGS_VERSION, exportedAt: new Date().toISOString(), meta }
}

/** 匯入：只接受這個 App 的本機設定檔，只寫入上面列的 key；回傳寫入幾項 */
export async function restoreLocalSettings(text: string): Promise<number> {
  let data: Partial<LocalSettingsFile>
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('檔案不是本機設定檔')
  }
  if (data.format !== LOCAL_SETTINGS_FORMAT || typeof data.meta !== 'object' || !data.meta) throw new Error('檔案不是摳摳手帳的本機設定檔')
  let n = 0
  for (const k of LOCAL_KEYS) {
    if (k in data.meta) {
      await setMeta(k, data.meta[k])
      n++
    }
  }
  return n
}
