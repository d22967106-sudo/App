import {
  AuthExpiredError,
  CloudError,
  deletePhotoBlobs,
  downloadPhotoBlob,
  getConfig,
  getSession,
  getSettings,
  rest,
  uploadPhotoBlob,
} from './cloud'
import {
  ackOutbox,
  applyRemote,
  cacheGet,
  cachePut,
  countOutbox,
  getLocal,
  getMeta,
  getOutbox,
  localVersion,
  markPhotoUploaded,
  onLocalChange,
  photosMissingThumb,
  setMeta,
  setPhotoThumb,
  SYNC_TABLES,
  type OutboxItem,
  type RemoteRow,
  type SyncTable,
} from './db'
import { checkPhotoQuota } from './photoQuota'
import type { Photo } from './types'

/**
 * 同步：先存手機、有網路再上傳。
 *   上傳：待上傳佇列裡的每一筆，讀本地最新內容 upsert 到 Supabase（本地已刪 → 雲端標成 deleted）。
 *         照片先把縮圖、顯示版傳到照片伺服器，成功後才寫照片資料，並把手機上的顯示版移到暫存。
 *   下載：每張表記住上次拉到的 server_updated_at，只拉之後改過的。
 */

/** 本地資料表 → Supabase 資料表 */
export const REMOTE_TABLE: Record<SyncTable, string> = {
  entries: 'entries',
  summaries: 'summaries',
  track: 'track_points',
  places: 'places',
  photos: 'photos',
  steps: 'daily_steps',
  trips: 'trips',
}

const PAGE = 500

/** 雲端可能還沒建立的表（下載失敗就跳過） */
const OPTIONAL_TABLES = new Set<SyncTable>(['steps', 'trips'])

function isMissingTable(table: SyncTable, e: unknown): boolean {
  return OPTIONAL_TABLES.has(table) && e instanceof CloudError && (e.status === 404 || /找不到資料表/.test(e.message))
}

/** 這次同步發現雲端還沒建立的表 */
const missingSet = new Set<SyncTable>()

/** 雲端還沒建立的表（例如還沒執行 phase4.sql 時的 trips） */
export function missingTables(): SyncTable[] {
  return [...missingSet]
}

/** 送到雲端的內容（照片不含圖檔本身） */
export function toRemoteData(table: SyncTable, rec: unknown): Record<string, unknown> {
  if (table === 'photos') {
    const { thumb, display: _d, uploaded: _u, ...meta } = rec as Photo
    return { ...meta, thumbType: thumb?.type ?? null }
  }
  return rec as Record<string, unknown>
}

// ── 狀態（給設定頁顯示） ──

export interface SyncStatus {
  running: boolean
  lastSyncAt: number | null
  lastError: string | null
  /** 待上傳筆數（含照片） */
  pending: number
  /** 因為「暫停照片上傳」而等待中的照片數 */
  photosPaused: number
  needLogin: boolean
}

let status: SyncStatus = { running: false, lastSyncAt: null, lastError: null, pending: 0, photosPaused: 0, needLogin: false }
const statusListeners = new Set<() => void>()

export function getSyncStatus(): SyncStatus {
  return status
}
export function onSyncStatus(fn: () => void): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  for (const fn of statusListeners) fn()
}

export async function refreshPending(): Promise<void> {
  setStatus({ pending: await countOutbox(), lastSyncAt: status.lastSyncAt ?? (await getMeta<number>('sync.lastAt')) ?? null })
}

/** 已設定雲端且已登入 */
export async function cloudReady(): Promise<boolean> {
  return !!(await getConfig()) && !!(await getSession())
}

// ── 上傳 ──

async function upsertRows(table: SyncTable, userId: string, rows: Omit<RemoteRow, never>[]): Promise<void> {
  if (!rows.length) return
  await rest(`${REMOTE_TABLE[table]}?on_conflict=user_id,id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows.map((r) => ({ ...r, user_id: userId }))),
  })
}

/** 上傳一張照片的圖檔；回傳 false 表示這次先跳過（暫停上傳或沒有圖檔） */
async function uploadPhotoFiles(photo: Photo, cacheLimit: number): Promise<boolean> {
  if (photo.uploaded) return true
  if (!photo.thumb) return false
  await uploadPhotoBlob(photo.id, 'thumb', photo.thumb)
  if (photo.display) await uploadPhotoBlob(photo.id, 'display', photo.display)
  const display = await markPhotoUploaded(photo.id)
  if (display) await cachePut(photo.id, display, cacheLimit)
  return true
}

async function push(userId: string): Promise<{ photosPaused: number }> {
  const settings = await getSettings()
  const hasPhotoServer = !!(await getConfig())?.photoUrl
  const cacheLimit = settings.cacheLimitMB * 1024 * 1024
  const items = await getOutbox()
  let photosPaused = 0
  // 照片圖檔一張一張傳，其他資料每張表一次送出
  for (const table of SYNC_TABLES) {
    const list = items.filter((i) => i.table === table)
    const rows: RemoteRow[] = []
    const done: OutboxItem[] = []
    for (const it of list) {
      const rec = await getLocal(table, it.id)
      if (!rec) {
        if (table === 'photos' && hasPhotoServer) await deletePhotoBlobs(it.id)
        rows.push({ id: it.id, updated_at: it.queuedAt, deleted: true, data: null })
        done.push(it)
        continue
      }
      if (table === 'photos') {
        if ((settings.pausePhotoUpload || !hasPhotoServer) && !(rec as Photo).uploaded) {
          photosPaused++
          continue
        }
        if (!(await uploadPhotoFiles(rec as Photo, cacheLimit))) continue
      }
      rows.push({ id: it.id, updated_at: localVersion(table, rec), deleted: false, data: toRemoteData(table, rec) })
      done.push(it)
      // 照片每張傳完就寫入，免得中途斷線白傳
      if (table === 'photos') {
        await upsertRows(table, userId, rows.splice(0))
        await ackOutbox(done.splice(0))
        setStatus({ pending: await countOutbox() })
      }
    }
    try {
      for (let i = 0; i < rows.length; i += PAGE) await upsertRows(table, userId, rows.slice(i, i + PAGE))
    } catch (e) {
      // 旅程表是第 4 階段才有的：還沒執行 phase4.sql 就先留在手機，等建好表再上傳
      if (isMissingTable(table, e)) {
        missingSet.add(table)
        continue
      }
      throw e
    }
    await ackOutbox(done)
  }
  return { photosPaused }
}

// ── 下載 ──

async function pull(userId: string): Promise<string[]> {
  const needThumb = new Set<string>()
  for (const table of SYNC_TABLES) {
    const cursorKey = `sync.cursor.${userId}.${table}`
    let cursor = (await getMeta<string>(cursorKey)) ?? null
    for (;;) {
      const filter = cursor ? `&server_updated_at=gt.${encodeURIComponent(cursor)}` : ''
      let res: Response
      try {
        res = await rest(
          `${REMOTE_TABLE[table]}?select=id,updated_at,deleted,data,server_updated_at${filter}&order=server_updated_at.asc&limit=${PAGE}`,
        )
      } catch (e) {
        // 步數表是第 3 階段才有的：還沒執行 automation.sql 就先跳過，不影響其他資料同步
        if (isMissingTable(table, e)) {
          missingSet.add(table)
          break
        }
        throw e
      }
      const rows = (await res.json()) as (RemoteRow & { server_updated_at: string })[]
      if (!rows.length) break
      const r = await applyRemote(table, rows)
      r.needThumb.forEach((id) => needThumb.add(id))
      cursor = rows[rows.length - 1].server_updated_at
      await setMeta(cursorKey, cursor)
      if (rows.length < PAGE) break
    }
  }
  return [...needThumb]
}

async function downloadThumbs(ids: string[]): Promise<void> {
  for (const id of ids) {
    const blob = await downloadPhotoBlob(id, 'thumb')
    if (blob) await setPhotoThumb(id, blob)
  }
}

// ── 對外 ──

let running: Promise<void> | null = null
let again = false

/** 立刻同步一次（正在同步就排在後面再跑一次） */
export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await syncOnce()
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

async function syncOnce(): Promise<void> {
  if (!(await getConfig())) return
  const session = await getSession()
  if (!session) {
    setStatus({ needLogin: true, pending: await countOutbox() })
    return
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ lastError: '目前沒有網路，有網路時會自動同步', pending: await countOutbox() })
    return
  }
  setStatus({ running: true, needLogin: false })
  missingSet.clear()
  try {
    const { photosPaused } = await push(session.userId)
    const needThumb = await pull(session.userId)
    if ((await getConfig())?.photoUrl) {
      const missing = new Set([...needThumb, ...(await photosMissingThumb())])
      await downloadThumbs([...missing])
      // 照片空間一天查一次，快滿時提醒（查不到不算同步失敗）
      checkPhotoQuota().catch(() => {})
    }
    await afterSync()
    const now = Date.now()
    await setMeta('sync.lastAt', now)
    setStatus({ lastSyncAt: now, lastError: null, photosPaused })
  } catch (e) {
    const needLogin = e instanceof AuthExpiredError
    setStatus({ lastError: e instanceof CloudError ? e.message : `同步失敗：${(e as Error).message}`, needLogin })
  } finally {
    setStatus({ running: false, pending: await countOutbox() })
  }
}

// 自動化的善後工作（補地名、更新時區）由 automation.ts 註冊，避免互相 import
let afterSyncHook: (() => Promise<void>) | null = null
export function setAfterSyncHook(fn: () => Promise<void>): void {
  afterSyncHook = fn
}
async function afterSync() {
  try {
    await afterSyncHook?.()
  } catch {
    /* 補地名失敗不算同步失敗，下次再補 */
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

/** 本地改了資料：過幾秒自動上傳（連續修改只傳一次） */
export function scheduleSync(delay = 3000): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    cloudReady().then((ok) => {
      if (ok) syncNow()
    })
  }, delay)
}

let started = false

/** App 啟動時呼叫：開啟、回到前景、恢復網路、本地有修改、每 5 分鐘都會同步 */
export function startAutoSync(): void {
  if (started) return
  started = true
  onLocalChange(() => {
    refreshPending()
    scheduleSync()
  })
  window.addEventListener('online', () => scheduleSync(500))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(500)
  })
  setInterval(() => document.visibilityState === 'visible' && scheduleSync(0), 5 * 60_000)
  refreshPending()
  scheduleSync(800)
}

// ── 大圖 ──

/**
 * 顯示版：手機上有就用手機的；否則看暫存；再沒有就從雲端下載並放進暫存。
 * 拿不到（離線、沒登入）回傳 null，畫面會改顯示縮圖。
 */
export async function getDisplayBlob(photo: Photo): Promise<Blob | null> {
  return (await loadDisplay(photo)).blob
}

/** 同 getDisplayBlob，另外回傳拿不到的原因（看大圖時顯示） */
export async function loadDisplay(photo: Photo): Promise<{ blob: Blob | null; error: string | null }> {
  if (photo.display) return { blob: photo.display, error: null }
  try {
    const cached = await cacheGet(photo.id)
    if (cached) return { blob: cached, error: null }
  } catch {
    /* 暫存讀不到就從雲端下載 */
  }
  if (!photo.uploaded) return { blob: null, error: '這張照片的大圖不在手機上，也還沒上傳到雲端' }
  if (!(await cloudReady()) || !(await getConfig())?.photoUrl) return { blob: null, error: '沒有登入雲端，無法下載大圖' }
  let blob: Blob | null
  try {
    blob = await downloadPhotoBlob(photo.id, 'display')
  } catch (e) {
    return { blob: null, error: `大圖下載失敗：${(e as Error).message}` }
  }
  if (!blob) return { blob: null, error: '雲端找不到這張照片的大圖' }
  try {
    const { cacheLimitMB } = await getSettings()
    await cachePut(photo.id, blob, cacheLimitMB * 1024 * 1024)
  } catch {
    /* 存不進暫存也照樣顯示，下次再下載 */
  }
  return { blob, error: null }
}
