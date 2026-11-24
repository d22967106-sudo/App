import { getMeta, setMeta } from './db'
import { notifyEntryEdits } from './entryRoute'
import { notifyRouteChange } from './snap'

/**
 * 路線操作的「上一步／下一步」（2026-11-24 使用者要求：可以回溯我的操作）：
 * 每次改路線（手繪、自動連線、刪除、還原、切段、合併、選交通方式）之前，把路線相關的設定整份記下來；
 * 上一步＝換回記下的那份，下一步＝再換回來。只記在這次打開的 App 裡（關掉 App 就清掉），最多 50 步。
 */

const KEYS = ['route.legEdits', 'route.entryEdits', 'route.legCuts', 'route.legModes'] as const
const MAX = 50

type Snap = Record<string, unknown>
const undoStack: Snap[] = []
const redoStack: Snap[] = []
const listeners = new Set<() => void>()

export function onHistoryChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = () => listeners.forEach((fn) => fn())

async function capture(): Promise<Snap> {
  const out: Snap = {}
  for (const k of KEYS) out[k] = structuredClone((await getMeta<unknown>(k)) ?? null)
  return out
}

async function restore(s: Snap): Promise<void> {
  for (const k of KEYS) await setMeta(k, s[k] ?? null)
  notifyRouteChange()
  notifyEntryEdits()
}

/** 做一個操作（裡面可以改好幾個設定，算一步） */
export async function routeStep<T>(fn: () => Promise<T>): Promise<T> {
  const before = await capture()
  const out = await fn()
  undoStack.push(before)
  if (undoStack.length > MAX) undoStack.shift()
  redoStack.length = 0
  emit()
  return out
}

export function historyState(): { canUndo: boolean; canRedo: boolean } {
  return { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }
}

export async function undoRoute(): Promise<boolean> {
  const s = undoStack.pop()
  if (!s) return false
  redoStack.push(await capture())
  await restore(s)
  emit()
  return true
}

export async function redoRoute(): Promise<boolean> {
  const s = redoStack.pop()
  if (!s) return false
  undoStack.push(await capture())
  await restore(s)
  emit()
  return true
}
