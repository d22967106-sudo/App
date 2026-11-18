import { strFromU8, strToU8, unzip, zip, type Unzipped } from 'fflate'
import { cacheGet, dumpAll, restoreAll } from './db'
import { getDisplayBlob } from './sync'
import { toDateKey } from './ledger'
import { photoExt } from './photos'
import type { DailySteps, DailySummary, Entry, Photo, Place, TrackPoint } from './types'

/**
 * 匯出格式（通用、不綁服務）：
 *   data.json            全部紀錄、每日總結、軌跡、去過的店、照片資訊、每日步數
 *   photos/<id>.thumb.webp|jpg
 *   photos/<id>.display.webp|jpg
 */
export const BACKUP_FORMAT = 'ledger-diary-backup'
export const BACKUP_VERSION = 1

type PhotoMeta = Omit<Photo, 'thumb' | 'display'> & { thumbFile: string | null; displayFile: string | null }

interface BackupJson {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  entries: Entry[]
  summaries: DailySummary[]
  track: TrackPoint[]
  places: Place[]
  photos: PhotoMeta[]
  /** 第 3 階段新增（舊備份沒有） */
  steps?: DailySteps[]
}

const zipAsync = (files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]>) =>
  new Promise<Uint8Array>((res, rej) => zip(files, { level: 6 }, (e, d) => (e ? rej(e) : res(d))))
const unzipAsync = (data: Uint8Array) =>
  new Promise<Unzipped>((res, rej) => unzip(data, (e, d) => (e ? rej(e) : res(d))))

const blobBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer())

/**
 * withCloudPhotos：大圖已經上傳到雲端、手機上沒有的，也從雲端下載放進備份
 * （照片多時檔案會很大、iPhone 記憶體可能不夠，所以預設只放手機上有的）。
 */
export async function buildBackup(
  opts: { withCloudPhotos?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ blob: Blob; filename: string; counts: Record<string, number> }> {
  const all = await dumpAll()
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}
  const photos: PhotoMeta[] = []
  let n = 0
  for (const p of all.photos) {
    opts.onProgress?.(n++, all.photos.length)
    let thumbFile: string | null = null
    if (p.thumb) {
      thumbFile = `photos/${p.id}.thumb.${photoExt(p.thumb)}`
      files[thumbFile] = [await blobBytes(p.thumb), { level: 0 }] // 已壓縮過，不再壓
    }
    let displayFile: string | null = null
    const display = p.display ?? (await cacheGet(p.id)) ?? (opts.withCloudPhotos ? await getDisplayBlob(p) : null)
    if (display) {
      displayFile = `photos/${p.id}.display.${photoExt(display)}`
      files[displayFile] = [await blobBytes(display), { level: 0 }]
    }
    const { thumb: _t, display: _d, ...meta } = p
    photos.push({ ...meta, thumbFile, displayFile })
  }
  const json: BackupJson = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    entries: all.entries,
    summaries: all.summaries,
    track: all.track,
    places: all.places,
    photos,
    steps: all.steps,
  }
  files['data.json'] = strToU8(JSON.stringify(json, null, 2))
  const data = await zipAsync(files)
  return {
    blob: new Blob([data as BlobPart], { type: 'application/zip' }),
    filename: `記帳日記備份-${toDateKey(new Date())}.zip`,
    counts: {
      entries: all.entries.length,
      summaries: all.summaries.length,
      track: all.track.length,
      photos: all.photos.length,
    },
  }
}

const mimeOf = (name: string) =>
  name.endsWith('.webp') ? 'image/webp' : name.endsWith('.png') ? 'image/png' : 'image/jpeg'

/** 匯入備份：同 id 的資料會被覆蓋，其他資料保留 */
export async function restoreBackup(file: Blob): Promise<{ entries: number; photos: number }> {
  const files = await unzipAsync(await blobBytes(file))
  const raw = files['data.json']
  if (!raw) throw new Error('這不是記帳日記的備份檔（找不到 data.json）')
  const json = JSON.parse(strFromU8(raw)) as BackupJson
  if (json.format !== BACKUP_FORMAT) throw new Error('這不是記帳日記的備份檔')
  if (json.version > BACKUP_VERSION) throw new Error('備份檔版本比 App 新，請先更新 App')
  const photos: Photo[] = []
  for (const m of json.photos ?? []) {
    const t = m.thumbFile ? files[m.thumbFile] : undefined
    const d = m.displayFile ? files[m.displayFile] : undefined
    // 沒有圖檔、也不在雲端的照片就跳過
    if (!t && !d && !m.uploaded) continue
    const { thumbFile, displayFile, ...rest } = m
    photos.push({
      ...rest,
      thumb: t && thumbFile ? new Blob([t as BlobPart], { type: mimeOf(thumbFile) }) : null,
      display: d && displayFile ? new Blob([d as BlobPart], { type: mimeOf(displayFile) }) : null,
    })
  }
  await restoreAll({
    entries: json.entries ?? [],
    summaries: json.summaries ?? [],
    track: json.track ?? [],
    places: json.places ?? [],
    photos,
    steps: json.steps ?? [],
  })
  return { entries: json.entries?.length ?? 0, photos: photos.length }
}

/** 下載或用 iOS 分享面板存到「檔案」 */
export async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
