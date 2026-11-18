import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from 'idb'
import { toDateKey } from './ledger'
import type { DailySteps, DailySummary, Entry, Photo, Place, RateCache, TrackPoint } from './types'

/** 會同步到雲端的資料表 */
export type SyncTable = 'entries' | 'summaries' | 'track' | 'places' | 'photos' | 'steps'
export const SYNC_TABLES: SyncTable[] = ['entries', 'summaries', 'track', 'places', 'photos', 'steps']

/** 待上傳佇列：只記「哪一筆改過」，上傳時再讀最新內容；本地已不存在就當成刪除 */
export interface OutboxItem {
  /** `${table}:${id}` */
  key: string
  table: SyncTable
  id: string
  /** 放進佇列的時間；刪除時也當成刪除時間 */
  queuedAt: number
}

/** 大圖暫存（從雲端下載或剛上傳完的顯示版），超過上限刪最久沒看的 */
export interface DisplayCacheItem {
  id: string
  /** 存 ArrayBuffer 而不是 Blob：iOS Safari 重複存取 Blob 會出錯 */
  data: ArrayBuffer
  type: string
  size: number
  lastAccess: number
}

interface LedgerDB extends DBSchema {
  entries: { key: string; value: Entry; indexes: { date: string } }
  summaries: { key: string; value: DailySummary }
  track: { key: string; value: TrackPoint; indexes: { date: string } }
  photos: { key: string; value: Photo; indexes: { entryId: string } }
  places: { key: string; value: Place }
  steps: { key: string; value: DailySteps }
  meta: { key: string; value: unknown }
  outbox: { key: string; value: OutboxItem }
  displayCache: { key: string; value: DisplayCacheItem; indexes: { lastAccess: number } }
}

export type StoreName = StoreNames<LedgerDB>

const DB_NAME = 'ledger-diary'
const DB_VERSION = 3

let dbPromise: Promise<IDBPDatabase<LedgerDB>> | null = null

export function getDB(): Promise<IDBPDatabase<LedgerDB>> {
  dbPromise ??= openDB<LedgerDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' })
        entries.createIndex('date', 'date')
        db.createObjectStore('summaries', { keyPath: 'date' })
        const track = db.createObjectStore('track', { keyPath: 'id' })
        track.createIndex('date', 'date')
        const photos = db.createObjectStore('photos', { keyPath: 'id' })
        photos.createIndex('entryId', 'entryId')
        db.createObjectStore('places', { keyPath: 'id' })
        db.createObjectStore('meta')
      }
      if (oldVersion < 2) {
        db.createObjectStore('outbox', { keyPath: 'key' })
        const cache = db.createObjectStore('displayCache', { keyPath: 'id' })
        cache.createIndex('lastAccess', 'lastAccess')
        // 第 1 階段的舊資料全部排進待上傳佇列，登入雲端後會上傳
        if (oldVersion >= 1) {
          const now = Date.now()
          const outbox = tx.objectStore('outbox')
          for (const table of ['entries', 'summaries', 'track', 'places', 'photos'] as const) {
            tx.objectStore(table)
              .getAllKeys()
              .then((keys) => {
                for (const id of keys) outbox.put({ key: `${table}:${id}`, table, id, queuedAt: now })
              })
          }
        }
      }
      if (oldVersion < 3) {
        db.createObjectStore('steps', { keyPath: 'date' })
      }
    },
  })
  return dbPromise
}

type AnyTx = IDBPTransaction<LedgerDB, StoreName[], 'readwrite'>

/** 在同一個交易裡把變更排進待上傳佇列 */
function queue(tx: AnyTx, table: SyncTable, id: string, at = Date.now()) {
  outboxChanged = true
  return tx.objectStore('outbox').put({ key: `${table}:${id}`, table, id, queuedAt: at })
}

// 本地有新變更時通知同步程式（debounce 後上傳）
let outboxChanged = false
const outboxListeners = new Set<() => void>()
export function onLocalChange(fn: () => void): () => void {
  outboxListeners.add(fn)
  return () => outboxListeners.delete(fn)
}
function flushOutboxSignal() {
  if (!outboxChanged) return
  outboxChanged = false
  for (const fn of outboxListeners) fn()
}

/** 測試用：關閉並清掉連線快取 */
export async function resetDBForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
}

// ── 變更通知：畫面用 useLiveQuery 訂閱，資料一改就重新查詢 ──

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function notify() {
  for (const fn of listeners) fn()
}

export function newId(): string {
  return crypto.randomUUID()
}

// ── 紀錄 ──

export async function getEntriesByDate(date: string): Promise<Entry[]> {
  const db = await getDB()
  const list = await db.getAllFromIndex('entries', 'date', date)
  return list.sort((a, b) => a.time - b.time)
}

export async function getEntry(id: string): Promise<Entry | undefined> {
  return (await getDB()).get('entries', id)
}

export async function getAllEntries(): Promise<Entry[]> {
  return (await getDB()).getAll('entries')
}

/** 儲存紀錄與它的照片；會刪掉這筆紀錄不再使用的照片 */
export async function saveEntry(entry: Entry, newPhotos: Photo[] = []): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['entries', 'photos', 'outbox', 'displayCache'], 'readwrite') as unknown as AnyTx
  const photos = tx.objectStore('photos')
  for (const p of newPhotos) {
    await photos.put(p)
    await queue(tx, 'photos', p.id)
  }
  const keep = new Set(entry.photoIds)
  const existing = await photos.index('entryId').getAllKeys(entry.id)
  for (const key of existing)
    if (!keep.has(key)) {
      await photos.delete(key)
      await tx.objectStore('displayCache').delete(key)
      await queue(tx, 'photos', key)
    }
  await tx.objectStore('entries').put(entry)
  await queue(tx, 'entries', entry.id)
  await tx.done
  notify()
  flushOutboxSignal()
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['entries', 'photos', 'outbox', 'displayCache'], 'readwrite') as unknown as AnyTx
  const photos = tx.objectStore('photos')
  for (const key of await photos.index('entryId').getAllKeys(id)) {
    await photos.delete(key)
    await tx.objectStore('displayCache').delete(key)
    await queue(tx, 'photos', key)
  }
  await tx.objectStore('entries').delete(id)
  await queue(tx, 'entries', id)
  await tx.done
  notify()
  flushOutboxSignal()
}

// ── 每日總結 ──

export async function getSummary(date: string): Promise<DailySummary | undefined> {
  return (await getDB()).get('summaries', date)
}

export async function saveSummary(s: DailySummary): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['summaries', 'outbox'], 'readwrite') as unknown as AnyTx
  if (!s.text.trim() && !s.mood) await tx.objectStore('summaries').delete(s.date)
  else await tx.objectStore('summaries').put(s)
  await queue(tx, 'summaries', s.date)
  await tx.done
  notify()
  flushOutboxSignal()
}

// ── 軌跡（手動定位） ──

export async function getTrackByDate(date: string): Promise<TrackPoint[]> {
  const list = await (await getDB()).getAllFromIndex('track', 'date', date)
  return list.sort((a, b) => a.time - b.time)
}

export async function addTrackPoint(p: TrackPoint): Promise<void> {
  const tx = (await getDB()).transaction(['track', 'outbox'], 'readwrite') as unknown as AnyTx
  await tx.objectStore('track').put(p)
  await queue(tx, 'track', p.id)
  await tx.done
  notify()
  flushOutboxSignal()
}

export async function deleteTrackPoint(id: string): Promise<void> {
  const tx = (await getDB()).transaction(['track', 'outbox'], 'readwrite') as unknown as AnyTx
  await tx.objectStore('track').delete(id)
  await queue(tx, 'track', id)
  await tx.done
  notify()
  flushOutboxSignal()
}

// ── 步數 ──

export async function getSteps(date: string): Promise<DailySteps | undefined> {
  return (await getDB()).get('steps', date)
}

// ── 照片 ──

export async function getPhoto(id: string): Promise<Photo | undefined> {
  return (await getDB()).get('photos', id)
}

// ── 去過的店 ──

export async function getAllPlaces(): Promise<Place[]> {
  return (await getDB()).getAll('places')
}

export async function putPlace(p: Place): Promise<void> {
  const tx = (await getDB()).transaction(['places', 'outbox'], 'readwrite') as unknown as AnyTx
  await tx.objectStore('places').put({ ...p, updatedAt: Date.now() })
  await queue(tx, 'places', p.id)
  await tx.done
  flushOutboxSignal()
}

// ── 其他設定 ──

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await getDB()).get('meta', key) as Promise<T | undefined>
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDB()).put('meta', value, key)
}

export async function getRateCache(): Promise<RateCache | undefined> {
  return getMeta<RateCache>('rates')
}

/** 匯出／匯入用：讀出全部資料（照片另外處理） */
export async function dumpAll() {
  const db = await getDB()
  return {
    entries: await db.getAll('entries'),
    summaries: await db.getAll('summaries'),
    track: await db.getAll('track'),
    places: await db.getAll('places'),
    photos: await db.getAll('photos'),
    steps: await db.getAll('steps'),
  }
}

export async function restoreAll(data: {
  entries: Entry[]
  summaries: DailySummary[]
  track: TrackPoint[]
  places: Place[]
  photos: Photo[]
  steps?: DailySteps[]
}): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['entries', 'summaries', 'track', 'places', 'photos', 'steps', 'outbox'], 'readwrite') as unknown as AnyTx
  for (const e of data.entries) {
    await tx.objectStore('entries').put(e)
    await queue(tx, 'entries', e.id)
  }
  for (const s of data.summaries) {
    await tx.objectStore('summaries').put(s)
    await queue(tx, 'summaries', s.date)
  }
  for (const t of data.track) {
    await tx.objectStore('track').put(t)
    await queue(tx, 'track', t.id)
  }
  for (const p of data.places) {
    await tx.objectStore('places').put(p)
    await queue(tx, 'places', p.id)
  }
  for (const p of data.photos) {
    await tx.objectStore('photos').put(p)
    await queue(tx, 'photos', p.id)
  }
  for (const s of data.steps ?? []) {
    await tx.objectStore('steps').put(s)
    await queue(tx, 'steps', s.date)
  }
  await tx.done
  notify()
  flushOutboxSignal()
}

/** 請瀏覽器把資料標成「不要自動清除」（iOS 加入主畫面後較不會被清） */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

// ── 同步用：待上傳佇列 ──

export async function getOutbox(): Promise<OutboxItem[]> {
  return (await getDB()).getAll('outbox')
}

export async function countOutbox(): Promise<number> {
  return (await getDB()).count('outbox')
}

/** 上傳成功後移除；如果上傳期間又改了（queuedAt 不同）就留著下次再傳 */
export async function ackOutbox(items: OutboxItem[]): Promise<void> {
  const tx = (await getDB()).transaction('outbox', 'readwrite')
  for (const it of items) {
    const cur = await tx.store.get(it.key)
    if (cur && cur.queuedAt === it.queuedAt) await tx.store.delete(it.key)
  }
  await tx.done
}

/** 讀出同步表裡的一筆本地資料 */
export async function getLocal(table: SyncTable, id: string): Promise<unknown> {
  return (await getDB()).get(table, id)
}

/** 本地資料的版本（最後修改時間），用來判斷雲端那份是不是比較新 */
export function localVersion(table: SyncTable, rec: unknown): number {
  const r = rec as Record<string, number | undefined>
  switch (table) {
    case 'entries':
    case 'summaries':
    case 'steps':
      return r.updatedAt ?? 0
    case 'places':
      return r.updatedAt ?? r.lastVisit ?? 0
    case 'track':
      return r.time ?? 0
    case 'photos':
      return r.createdAt ?? 0
  }
}

export interface RemoteRow {
  id: string
  updated_at: number
  deleted: boolean
  data: Record<string, unknown> | null
}

/**
 * 套用從雲端拉下來的資料（不會再排進待上傳佇列）。
 * 規則：本地還有沒上傳的修改就保留本地；雲端標成刪除就刪；否則雲端比較新才覆蓋。
 * 回傳需要下載縮圖的照片 id。
 */
export async function applyRemote(table: SyncTable, rows: RemoteRow[]): Promise<{ changed: number; needThumb: string[] }> {
  const db = await getDB()
  const tx = db.transaction([table, 'outbox', 'displayCache'], 'readwrite') as unknown as AnyTx
  const store = tx.objectStore(table)
  let changed = 0
  const needThumb: string[] = []
  for (const row of rows) {
    if (await tx.objectStore('outbox').get(`${table}:${row.id}`)) continue
    const local = await store.get(row.id)
    if (row.deleted || !row.data) {
      if (local) {
        await store.delete(row.id)
        if (table === 'photos') await tx.objectStore('displayCache').delete(row.id)
        changed++
      }
      continue
    }
    if (table === 'photos') {
      // 手機上已經有這張照片就保留（不重新存圖檔，iOS 會出錯）；沒有才建立，縮圖之後下載
      const p = local as Photo | undefined
      if (!p) {
        await store.put({ ...(row.data as unknown as Photo), thumb: null, display: null, uploaded: true })
        changed++
        needThumb.push(row.id)
      } else if (!p.thumb) needThumb.push(row.id)
      continue
    }
    if (!local || row.updated_at > localVersion(table, local)) {
      await store.put(withLocalDate(table, row.data) as never)
      changed++
    }
  }
  await tx.done
  if (changed) notify()
  return { changed, needThumb }
}

/**
 * 背景定位與捷徑的資料是伺服器算的日期（用金鑰設定的時區），
 * 在手機上改用這支手機的時區重新算，跟 App 自己記的資料一致。
 */
export function withLocalDate(table: SyncTable, data: Record<string, unknown>): Record<string, unknown> {
  const auto = (table === 'track' && data.source === 'auto') || (table === 'entries' && data.source === 'shortcut')
  if (!auto || typeof data.time !== 'number') return data
  return { ...data, date: toDateKey(data.time) }
}

/** 照片上傳完成：標記已上傳，顯示版移到暫存（不再永久佔手機空間） */
/**
 * iOS Safari 不能把「從 IndexedDB 讀出來的 Blob」或「網路下載的 Blob」直接再存回去
 * （會出現 Error preparing Blob/File data to be stored in object store），
 * 所以要存之前先複製成一個全新的 Blob。複製要在交易外面做（交易裡不能等其他非同步工作）。
 */
export async function freshBlob(b: Blob): Promise<Blob> {
  return new Blob([await b.arrayBuffer()], { type: b.type })
}

export async function markPhotoUploaded(id: string): Promise<Blob | null> {
  const db = await getDB()
  const p = await db.get('photos', id)
  if (!p) return null
  const thumb = p.thumb ? await freshBlob(p.thumb) : null
  const display = p.display ? await freshBlob(p.display) : null
  await db.put('photos', { ...p, thumb, display: null, uploaded: true })
  return display
}

export async function setPhotoThumb(id: string, blob: Blob): Promise<void> {
  const db = await getDB()
  const thumb = await freshBlob(blob)
  const p = await db.get('photos', id)
  if (p) await db.put('photos', { ...p, thumb, display: p.display ? await freshBlob(p.display) : null })
  if (p) {
    notify()
    for (const fn of thumbListeners) fn()
  }
}

const thumbListeners = new Set<() => void>()
/** 有照片縮圖從雲端下載完成時通知（地圖縮圖用） */
export function onPhotoThumb(fn: () => void): () => void {
  thumbListeners.add(fn)
  return () => thumbListeners.delete(fn)
}

export async function photosMissingThumb(): Promise<string[]> {
  const all = await (await getDB()).getAll('photos')
  return all.filter((p) => !p.thumb && p.uploaded).map((p) => p.id)
}

// ── 大圖暫存（LRU） ──

export async function cacheGet(id: string): Promise<Blob | undefined> {
  const db = await getDB()
  const it = await db.get('displayCache', id)
  if (!it?.data) return undefined
  db.put('displayCache', { ...it, lastAccess: Date.now() }).catch(() => {})
  return new Blob([it.data], { type: it.type })
}

export async function cachePut(id: string, blob: Blob, limitBytes: number): Promise<void> {
  const db = await getDB()
  const data = await blob.arrayBuffer()
  await db.put('displayCache', { id, data, type: blob.type, size: data.byteLength, lastAccess: Date.now() })
  await cacheTrim(limitBytes)
}

/** 超過上限就從最久沒看的開始刪 */
export async function cacheTrim(limitBytes: number): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('displayCache', 'readwrite')
  const all = await tx.store.index('lastAccess').getAll()
  let total = all.reduce((a, b) => a + b.size, 0)
  for (const it of all) {
    if (total <= limitBytes) break
    await tx.store.delete(it.id)
    total -= it.size
  }
  await tx.done
}

export async function cacheUsage(): Promise<{ count: number; bytes: number }> {
  const all = await (await getDB()).getAll('displayCache')
  return { count: all.length, bytes: all.reduce((a, b) => a + b.size, 0) }
}

export async function cacheClear(): Promise<void> {
  await (await getDB()).clear('displayCache')
}
