/**
 * 照片空間提醒：Cloudflare R2 免費 10 GB，超過會直接收費（不會擋下來），
 * 所以 App 自己每天查一次用量，快滿時提醒。
 *
 * - 查詢：同步完成後，距離上次查超過 1 天才查（Worker 列檔案算 R2 的寫入類操作，一天一次很省）。
 * - 8 GB 以上：提醒「快滿了」；9.5 GB 以上：「就快滿了」；超過 10 GB：「已開始收費」。
 * - 跳通知一天最多一次；新增紀錄的照片區、設定頁的「使用狀況」入口會一直顯示提醒。
 */
import { useSyncExternalStore } from 'react'
import { fetchPhotoUsage } from './cloud'
import { getMeta, setMeta } from './db'
import { formatBytes, PHOTO_LIMIT } from './usage'

export type QuotaLevel = 'ok' | 'warn' | 'high' | 'over'

export interface PhotoQuota {
  bytes: number
  objects: number
  checkedAt: number
}

export const WARN_AT = 8 * 1024 ** 3
export const HIGH_AT = 9.5 * 1024 ** 3
const DAY = 86400000

export function quotaLevel(bytes: number): QuotaLevel {
  if (bytes > PHOTO_LIMIT) return 'over'
  if (bytes >= HIGH_AT) return 'high'
  if (bytes >= WARN_AT) return 'warn'
  return 'ok'
}

/** 提醒文字；沒有要提醒回傳 null */
export function quotaMessage(bytes: number): string | null {
  const used = formatBytes(bytes)
  switch (quotaLevel(bytes)) {
    case 'over':
      return `照片已用 ${used}，超過免費的 10 GB，超過的部分 Cloudflare 會開始收費`
    case 'high':
      return `照片已用 ${used}，就快到免費的 10 GB 了，超過會開始收費`
    case 'warn':
      return `照片已用 ${used}，免費 10 GB 快用完了`
    default:
      return null
  }
}

export function needsCheck(last: PhotoQuota | undefined, now: number): boolean {
  return !last || now - last.checkedAt >= DAY
}

/** 要不要跳通知：有提醒、而且今天還沒跳過 */
export function shouldNotify(bytes: number, lastNotifiedAt: number | undefined, now: number): boolean {
  return quotaLevel(bytes) !== 'ok' && (!lastNotifiedAt || now - lastNotifiedAt >= DAY)
}

// ── 給畫面用的狀態 ──

let current: PhotoQuota | null = null
let loaded = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function getPhotoQuota(): PhotoQuota | null {
  return current
}

export function onPhotoQuota(fn: () => void): () => void {
  listeners.add(fn)
  if (!loaded) {
    loaded = true
    getMeta<PhotoQuota>('photoQuota')
      .then((q) => {
        if (q && !current) {
          current = q
          emit()
        }
      })
      .catch(() => {})
  }
  return () => listeners.delete(fn)
}

/** 畫面用：目前的提醒文字（沒有提醒是 null） */
export function usePhotoQuotaMessage(): string | null {
  const q = useSyncExternalStore(onPhotoQuota, getPhotoQuota)
  return q ? quotaMessage(q.bytes) : null
}

/** 記下最新用量（使用狀況頁查到時也會呼叫） */
export async function savePhotoQuota(bytes: number, objects: number, now = Date.now()): Promise<void> {
  current = { bytes, objects, checkedAt: now }
  emit()
  await setMeta('photoQuota', current)
}

let notifier: (text: string) => void = () => {}
/** App 啟動時設定：要怎麼跳通知（避免 lib 依賴畫面元件） */
export function setQuotaNotifier(fn: (text: string) => void): void {
  notifier = fn
}

/** 同步後呼叫：一天查一次，需要的話跳通知 */
export async function checkPhotoQuota(notify: (text: string) => void = notifier, now = Date.now()): Promise<void> {
  const last = await getMeta<PhotoQuota>('photoQuota')
  if (last && !current) {
    current = last
    emit()
  }
  if (!needsCheck(last, now)) return
  const usage = await fetchPhotoUsage()
  if (!usage) return
  await savePhotoQuota(usage.bytes, usage.objects, now)
  const lastNotifiedAt = await getMeta<number>('photoQuota.notifiedAt')
  const msg = quotaMessage(usage.bytes)
  if (msg && shouldNotify(usage.bytes, lastNotifiedAt, now)) {
    notify(msg)
    await setMeta('photoQuota.notifiedAt', now)
  }
}
