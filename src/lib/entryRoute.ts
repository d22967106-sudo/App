import { getMeta, setMeta } from './db'
import type { RoutePoint } from './day'
import { routeKm } from './geo'
import type { GeoPoint } from './types'

/**
 * 從記帳點手繪路線（2026-11-24 使用者要求「可以從我的記帳點手繪路線」）：
 * 選一筆有地點的紀錄，從那裡用手指畫到下一個地點（下一筆有地點的紀錄或手動定位）。
 * 存的是畫的線（貼齊道路後），畫在地圖上時頭尾自動接上這筆紀錄和下一個地點，
 * 所以紀錄的位置一定在線上（實際的點是事實，畫的線只補中間怎麼走）。
 * 存 meta `route.entryEdits`（key＝日期/紀錄 id），跟路段的手繪修改一樣只存在手機上、不同步。
 */

type EditMap = Record<string, [number, number][]>
export type EntryEdits = Record<string, GeoPoint[]>

const KEY = 'route.entryEdits'

const listeners = new Set<() => void>()
export function onEntryEditsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function notifyEntryEdits(): void {
  listeners.forEach((fn) => fn())
}

/** 某一天的手繪路線（key＝紀錄 id） */
export async function getEntryEdits(date: string): Promise<EntryEdits> {
  const all = (await getMeta<EditMap>(KEY)) ?? {}
  const out: EntryEdits = {}
  const prefix = `${date}/`
  for (const [k, v] of Object.entries(all)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v.map(([lat, lng]) => ({ lat, lng }))
  return out
}

export async function setEntryEdit(date: string, entryId: string, line: GeoPoint[] | null): Promise<void> {
  const all = (await getMeta<EditMap>(KEY)) ?? {}
  const k = `${date}/${entryId}`
  if (line && line.length) all[k] = line.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6])
  else delete all[k]
  await setMeta(KEY, all)
  listeners.forEach((fn) => fn())
}

/** 可以當終點的點：有地點的紀錄、手動定位（背景定位經過的點不算） */
export type IsAnchor = (p: RoutePoint) => boolean

/** 這筆紀錄的下一個地點（畫的線接到這裡）；沒有就 null */
export function nextAnchor(route: RoutePoint[], entryId: string, isAnchor: IsAnchor): RoutePoint | null {
  const i = route.findIndex((p) => p.ref.type === 'entry' && p.ref.id === entryId)
  if (i < 0) return null
  for (let j = i + 1; j < route.length; j++) if (isAnchor(route[j])) return route[j]
  return null
}

function pushPt(out: GeoPoint[], p: GeoPoint) {
  const last = out[out.length - 1]
  if (!last || last.lat !== p.lat || last.lng !== p.lng) out.push({ lat: p.lat, lng: p.lng })
}

/**
 * 沒有背景定位移動的日子：照時間連紀錄和定位點，從有手繪路線的紀錄到下一個地點那一段換成畫的線
 * （中間背景定位停著時飄移的點跳過）。最後一個地點畫的線就照畫的停在那裡。
 */
export function routeWithEntryEdits(route: RoutePoint[], edits: EntryEdits, isAnchor: IsAnchor): GeoPoint[] {
  const out: GeoPoint[] = []
  for (let i = 0; i < route.length; i++) {
    const p = route[i]
    pushPt(out, p)
    const ed = p.ref.type === 'entry' ? edits[p.ref.id] : undefined
    if (!ed?.length) continue
    for (const q of ed) pushPt(out, q)
    // 跳到下一個地點（它下一圈會被接上）
    let j = i + 1
    while (j < route.length && !isAnchor(route[j])) j++
    i = j - 1
  }
  return out
}

/** 有背景定位移動的日子：手繪路線另外畫一條，從紀錄的位置開始 */
export function entryEditLine(entry: GeoPoint, edit: GeoPoint[], next: GeoPoint | null): GeoPoint[] {
  const out: GeoPoint[] = []
  pushPt(out, entry)
  for (const q of edit) pushPt(out, q)
  if (next) pushPt(out, next)
  return out
}

export function lineKm(line: GeoPoint[]): number {
  return routeKm(line)
}
