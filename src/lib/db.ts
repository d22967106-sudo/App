import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { DailySummary, Entry, Photo, Place, RateCache, TrackPoint } from './types'

interface LedgerDB extends DBSchema {
  entries: { key: string; value: Entry; indexes: { date: string } }
  summaries: { key: string; value: DailySummary }
  track: { key: string; value: TrackPoint; indexes: { date: string } }
  photos: { key: string; value: Photo; indexes: { entryId: string } }
  places: { key: string; value: Place }
  meta: { key: string; value: unknown }
}

export type StoreName = 'entries' | 'summaries' | 'track' | 'photos' | 'places' | 'meta'

const DB_NAME = 'ledger-diary'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<LedgerDB>> | null = null

export function getDB(): Promise<IDBPDatabase<LedgerDB>> {
  dbPromise ??= openDB<LedgerDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const entries = db.createObjectStore('entries', { keyPath: 'id' })
      entries.createIndex('date', 'date')
      db.createObjectStore('summaries', { keyPath: 'date' })
      const track = db.createObjectStore('track', { keyPath: 'id' })
      track.createIndex('date', 'date')
      const photos = db.createObjectStore('photos', { keyPath: 'id' })
      photos.createIndex('entryId', 'entryId')
      db.createObjectStore('places', { keyPath: 'id' })
      db.createObjectStore('meta')
    },
  })
  return dbPromise
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
  const tx = db.transaction(['entries', 'photos'], 'readwrite')
  const photos = tx.objectStore('photos')
  for (const p of newPhotos) await photos.put(p)
  const keep = new Set(entry.photoIds)
  const existing = await photos.index('entryId').getAllKeys(entry.id)
  for (const key of existing) if (!keep.has(key)) await photos.delete(key)
  await tx.objectStore('entries').put(entry)
  await tx.done
  notify()
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['entries', 'photos'], 'readwrite')
  const photos = tx.objectStore('photos')
  for (const key of await photos.index('entryId').getAllKeys(id)) await photos.delete(key)
  await tx.objectStore('entries').delete(id)
  await tx.done
  notify()
}

// ── 每日總結 ──

export async function getSummary(date: string): Promise<DailySummary | undefined> {
  return (await getDB()).get('summaries', date)
}

export async function saveSummary(s: DailySummary): Promise<void> {
  const db = await getDB()
  if (!s.text.trim() && !s.mood) await db.delete('summaries', s.date)
  else await db.put('summaries', s)
  notify()
}

// ── 軌跡（手動定位） ──

export async function getTrackByDate(date: string): Promise<TrackPoint[]> {
  const list = await (await getDB()).getAllFromIndex('track', 'date', date)
  return list.sort((a, b) => a.time - b.time)
}

export async function addTrackPoint(p: TrackPoint): Promise<void> {
  await (await getDB()).put('track', p)
  notify()
}

export async function deleteTrackPoint(id: string): Promise<void> {
  await (await getDB()).delete('track', id)
  notify()
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
  await (await getDB()).put('places', p)
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
  }
}

export async function restoreAll(data: {
  entries: Entry[]
  summaries: DailySummary[]
  track: TrackPoint[]
  places: Place[]
  photos: Photo[]
}): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['entries', 'summaries', 'track', 'places', 'photos'], 'readwrite')
  for (const e of data.entries) await tx.objectStore('entries').put(e)
  for (const s of data.summaries) await tx.objectStore('summaries').put(s)
  for (const t of data.track) await tx.objectStore('track').put(t)
  for (const p of data.places) await tx.objectStore('places').put(p)
  for (const p of data.photos) await tx.objectStore('photos').put(p)
  await tx.done
  notify()
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
