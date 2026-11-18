import { CloudError, getConfig, getSession, rest } from './cloud'
import { getAllEntries, getMeta, saveEntry, setMeta } from './db'
import { reverseGeocode } from './geocode'
import { setAfterSyncHook } from './sync'
import automationSql from '../../supabase/automation.sql?raw'
import scriptableTemplate from '../../scriptable/ledger-widget.js?raw'

/**
 * 第 3 階段：自動化（背景定位 App、捷徑、Scriptable 小工具）。
 *
 * 這些工具沒辦法用帳號密碼登入，所以用一把「自動化金鑰」：
 *   App 產生金鑰 → 只把 sha256 雜湊存進 Supabase 的 api_keys（金鑰本身只在這支手機上）
 *   → 背景定位 App／捷徑／小工具帶著金鑰打照片伺服器的 /auto/… → Worker 用金鑰呼叫 Supabase 的 auto_* 函式。
 * 重新產生金鑰，舊的就失效。
 */

export { automationSql }

export interface AutoKey {
  key: string
  createdAt: number
  /** 註冊時的時區 */
  tz: string
}

const META_KEY = 'auto.key'

export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'
  } catch {
    return 'Asia/Taipei'
  }
}

export async function getAutoKey(): Promise<AutoKey | null> {
  return (await getMeta<AutoKey>(META_KEY)) ?? null
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 32 bytes 亂數 → 網址安全的文字（43 字） */
export function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return 'ld_' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function explain(e: unknown): Error {
  if (e instanceof CloudError && (e.status === 404 || /api_keys|找不到資料表/.test(e.message)))
    return new Error('Supabase 還沒建立自動化用的資料表：請先按「複製設定 SQL」，到 Supabase 的 SQL Editor 貼上執行')
  return e as Error
}

/** 產生（或重新產生）金鑰；舊的金鑰立刻失效 */
export async function createAutoKey(): Promise<AutoKey> {
  const session = await getSession()
  if (!session) throw new Error('請先登入雲端')
  const key = randomKey()
  const tz = currentTimeZone()
  try {
    await rest('api_keys?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: session.userId, key_hash: await sha256Hex(key), tz, created_at: new Date().toISOString() }),
    })
  } catch (e) {
    throw explain(e)
  }
  const k: AutoKey = { key, createdAt: Date.now(), tz }
  await setMeta(META_KEY, k)
  return k
}

/** 人在國外時更新時區（伺服器用它算捷徑送來的資料是哪一天） */
export async function updateTimeZone(): Promise<void> {
  const k = await getAutoKey()
  const session = await getSession()
  if (!k || !session) return
  const tz = currentTimeZone()
  if (tz === k.tz) return
  await rest(`api_keys?user_id=eq.${session.userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ tz }),
  })
  await setMeta(META_KEY, { ...k, tz })
}

// ── 各種工具要填的網址 ──

export interface AutoLinks {
  base: string
  overland: string
  overlandSetup: string
  owntracks: string
  entry: string
  steps: string
  location: string
  widget: string
}

export function buildLinks(workerUrl: string, key: string): AutoLinks {
  const base = workerUrl.replace(/\/+$/, '') + '/auto'
  const overland = `${base}/overland`
  return {
    base,
    overland,
    overlandSetup: `overland://setup?url=${encodeURIComponent(overland)}&token=${encodeURIComponent(key)}&device_id=iphone`,
    owntracks: `${base}/owntracks?key=${encodeURIComponent(key)}`,
    entry: `${base}/entry`,
    steps: `${base}/steps`,
    location: `${base}/location`,
    widget: `${base}/widget`,
  }
}

/** App 自己的網址（小工具點下去打開） */
export function appUrl(): string {
  return new URL(import.meta.env.BASE_URL, location.origin).href
}

/** 腳本範本第一行寫的版本（改腳本時記得改版本，使用者才知道要重新貼上） */
export const SCRIPT_VERSION = /版本\s*(\S+)/.exec(scriptableTemplate)?.[1] ?? '?'

/** 產生 Scriptable 腳本：把網址、金鑰、每月預算填進範本 */
export function buildScriptable(opts: { workerUrl: string; key: string; budget: number; appUrl: string }): string {
  const base = opts.workerUrl.replace(/\/+$/, '') + '/auto'
  return scriptableTemplate
    .replace('__BASE__', base)
    .replace('__KEY__', opts.key)
    .replace('__BUDGET__', String(Math.max(0, Math.round(opts.budget) || 0)))
    .replace('__APP_URL__', opts.appUrl)
}

/** 測試金鑰與 Worker 是否正常 */
export async function checkAuto(workerUrl: string, key: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${workerUrl.replace(/\/+$/, '')}/auto/check`, { headers: { Authorization: `Bearer ${key}` } })
  } catch {
    throw new Error('連不上照片伺服器')
  }
  const text = await res.text()
  if (res.status === 404 && !/金鑰|SQL/.test(text)) throw new Error('照片伺服器還沒更新到有自動化功能的版本')
  if (!res.ok) throw new Error(text || `HTTP ${res.status}`)
  return text
}

// ── 同步後的善後：捷徑記的帳補上地名 ──

/** 一次最多補幾筆（Nominatim 每秒 1 次） */
const FILL_LIMIT = 5

export async function fillShortcutPlaceNames(): Promise<number> {
  const list = (await getAllEntries())
    .filter((e) => e.source === 'shortcut' && e.location && !e.location.name)
    .sort((a, b) => b.time - a.time)
    .slice(0, FILL_LIMIT)
  let n = 0
  for (const e of list) {
    const r = await reverseGeocode(e.location!)
    if (!r) break // 離線或被限流：下次再補
    await saveEntry({ ...e, location: { ...e.location!, name: r.name, countryCode: r.countryCode, address: r.address }, updatedAt: Date.now() })
    n++
  }
  return n
}

export function installAutomationHooks(): void {
  setAfterSyncHook(async () => {
    if (!(await getConfig())) return
    await updateTimeZone().catch(() => {})
    await fillShortcutPlaceNames()
  })
}
