import { getMeta, setMeta } from './db'

/**
 * 雲端設定與登入（Supabase）。
 * 不用 supabase-js，只用到幾個 REST 端點：建立帳號、密碼登入、換新 token、讀寫資料表。
 * Supabase 的 anon／publishable key 是公開的，安全靠資料表的 RLS；
 * 照片伺服器（Cloudflare Worker）網址也是公開的，上傳下載都要帶登入 token。
 */

export interface CloudConfig {
  /** https://xxxx.supabase.co */
  url: string
  /** anon key 或 sb_publishable_… */
  key: string
  /** 照片伺服器 https://xxx.workers.dev */
  photoUrl: string
}

export interface CloudSession {
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
  userId: string
  email: string
}

export interface CloudSettings {
  /** 暫停照片上傳（例如出國用行動網路時）；iOS 的網頁偵測不到是不是 Wi-Fi，只能手動切換 */
  pausePhotoUpload: boolean
  /** 大圖暫存上限（MB） */
  cacheLimitMB: number
}

export const DEFAULT_SETTINGS: CloudSettings = { pausePhotoUpload: false, cacheLimitMB: 200 }

export class CloudError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

/** 登入過期、需要重新登入 */
export class AuthExpiredError extends CloudError {}

// ── 設定 ──

const trimSlash = (s: string) => s.trim().replace(/\/+$/, '')

export function normalizeConfig(c: CloudConfig): CloudConfig {
  let url = trimSlash(c.url)
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url
  let photoUrl = trimSlash(c.photoUrl)
  if (photoUrl && !/^https?:\/\//.test(photoUrl)) photoUrl = 'https://' + photoUrl
  return { url, key: c.key.trim(), photoUrl }
}

export function validateConfig(c: CloudConfig): string | null {
  if (!/^https:\/\/[^/]+$/.test(c.url)) return 'Supabase 網址格式不對，應該像 https://abcd.supabase.co'
  if (c.key.length < 20) return 'Supabase key 看起來不完整'
  if (c.photoUrl && !/^https:\/\/[^/]+$/.test(c.photoUrl)) return '照片伺服器網址格式不對，應該像 https://photos.xxx.workers.dev'
  return null
}

export async function getConfig(): Promise<CloudConfig | null> {
  return (await getMeta<CloudConfig>('cloud.config')) ?? null
}

export async function saveConfig(c: CloudConfig | null): Promise<void> {
  await setMeta('cloud.config', c ? normalizeConfig(c) : null)
  emit()
}

export async function getSettings(): Promise<CloudSettings> {
  return { ...DEFAULT_SETTINGS, ...((await getMeta<Partial<CloudSettings>>('cloud.settings')) ?? {}) }
}

export async function saveSettings(s: Partial<CloudSettings>): Promise<void> {
  await setMeta('cloud.settings', { ...(await getSettings()), ...s })
  emit()
}

export async function getSession(): Promise<CloudSession | null> {
  return (await getMeta<CloudSession>('cloud.session')) ?? null
}

async function saveSession(s: CloudSession | null): Promise<void> {
  await setMeta('cloud.session', s)
  emit()
}

// 設定或登入狀態改變時通知畫面
const listeners = new Set<() => void>()
export function onCloudChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit() {
  for (const fn of listeners) fn()
}

// ── 登入 ──

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return String(j.msg ?? j.message ?? j.error_description ?? j.error ?? j.hint ?? res.statusText)
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

function authHeaders(cfg: CloudConfig): Record<string, string> {
  return { apikey: cfg.key, 'Content-Type': 'application/json' }
}

async function authFetch(cfg: CloudConfig, path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${cfg.url}/auth/v1/${path}`, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(body),
    })
  } catch {
    throw new CloudError('連不上 Supabase，請確認網路與網址')
  }
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at?: number
  user: { id: string; email?: string }
}

function toSession(t: TokenResponse, email?: string): CloudSession {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_at ? t.expires_at * 1000 : Date.now() + t.expires_in * 1000,
    userId: t.user.id,
    email: t.user.email ?? email ?? '',
  }
}

/**
 * 登入方式：電子郵件＋密碼。
 * （原本想用信箱驗證碼，但 Supabase 新的免費專案不能改登入信範本，信裡不會有數字驗證碼；
 *   信裡的連結又會開到 Safari 而不是主畫面 App，所以改用密碼。）
 */
export async function signInWithPassword(email: string, password: string): Promise<CloudSession> {
  const cfg = await requireConfig()
  const res = await authFetch(cfg, 'token?grant_type=password', { email: email.trim(), password })
  if (!res.ok) {
    const msg = await readError(res)
    if (/email not confirmed/i.test(msg))
      throw new CloudError('這個帳號還沒完成信箱確認：請到 Supabase 關閉「Confirm email」，或點確認信裡的連結後再登入', res.status)
    if (res.status === 400 || /invalid login credentials/i.test(msg))
      throw new CloudError('電子郵件或密碼不對（第一次使用請按「建立帳號」）', res.status)
    if (res.status === 429) throw new CloudError('嘗試太多次了，請過一陣子再試', 429)
    throw new CloudError(`登入失敗：${msg}`, res.status)
  }
  const s = toSession((await res.json()) as TokenResponse, email)
  await saveSession(s)
  return s
}

/** 第一次使用：建立帳號。Supabase 有關閉「Confirm email」的話會直接登入 */
export async function signUpWithPassword(email: string, password: string): Promise<CloudSession | null> {
  const cfg = await requireConfig()
  if (password.length < 8) throw new CloudError('密碼至少要 8 個字')
  const res = await authFetch(cfg, 'signup', { email: email.trim(), password })
  if (!res.ok) {
    const msg = await readError(res)
    if (/already registered|already exists/i.test(msg)) throw new CloudError('這個信箱已經有帳號了，請直接登入', res.status)
    if (/signups? not allowed/i.test(msg)) throw new CloudError('已關閉註冊，請直接登入', res.status)
    if (/password/i.test(msg)) throw new CloudError(`密碼不符合要求：${msg}`, res.status)
    if (res.status === 429) throw new CloudError('嘗試太多次了，請過一陣子再試', 429)
    throw new CloudError(`建立帳號失敗：${msg}`, res.status)
  }
  const body = (await res.json()) as Partial<TokenResponse>
  // 需要信箱確認時不會回傳 token
  if (!body.access_token) return null
  const s = toSession(body as TokenResponse, email)
  await saveSession(s)
  return s
}

export async function signOut(): Promise<void> {
  const cfg = await getConfig()
  const s = await getSession()
  if (cfg && s) {
    fetch(`${cfg.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { ...authHeaders(cfg), Authorization: `Bearer ${s.accessToken}` },
    }).catch(() => {})
  }
  await saveSession(null)
}

async function requireConfig(): Promise<CloudConfig> {
  const cfg = await getConfig()
  if (!cfg) throw new CloudError('還沒設定雲端')
  return cfg
}

let refreshing: Promise<CloudSession> | null = null

/** 取得有效的 access token；快過期就先換新的 */
export async function getAccessToken(): Promise<{ token: string; session: CloudSession; cfg: CloudConfig }> {
  const cfg = await requireConfig()
  let s = await getSession()
  if (!s) throw new AuthExpiredError('尚未登入')
  if (s.expiresAt - Date.now() < 60_000) {
    refreshing ??= refreshSession(cfg, s).finally(() => (refreshing = null))
    s = await refreshing
  }
  return { token: s.accessToken, session: s, cfg }
}

async function refreshSession(cfg: CloudConfig, s: CloudSession): Promise<CloudSession> {
  const res = await authFetch(cfg, 'token?grant_type=refresh_token', { refresh_token: s.refreshToken })
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      await saveSession(null)
      throw new AuthExpiredError('登入已過期，請重新登入', res.status)
    }
    throw new CloudError(`更新登入失敗：HTTP ${res.status}`, res.status)
  }
  const next = toSession((await res.json()) as TokenResponse, s.email)
  await saveSession(next)
  return next
}

// ── 資料表 ──

/** 呼叫 Supabase 的資料表 API（PostgREST），自動帶登入 token */
export async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const { token, cfg } = await getAccessToken()
  let res: Response
  try {
    res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    })
  } catch {
    throw new CloudError('連不上 Supabase')
  }
  if (!res.ok) {
    const msg = await readError(res)
    if (res.status === 401) throw new AuthExpiredError(`登入失效：${msg}`, 401)
    if (res.status === 404 || /relation .* does not exist|schema cache/i.test(msg))
      throw new CloudError(`找不到資料表，請確認已在 Supabase 執行 schema.sql（${msg}）`, res.status)
    throw new CloudError(`Supabase：${msg}`, res.status)
  }
  return res
}

// ── 照片伺服器 ──

async function photoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { token, cfg } = await getAccessToken()
  if (!cfg.photoUrl) throw new CloudError('還沒設定照片伺服器網址')
  let res: Response
  try {
    res = await fetch(`${cfg.photoUrl}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
    })
  } catch {
    throw new CloudError('連不上照片伺服器')
  }
  if (!res.ok && res.status !== 404) {
    let msg = `HTTP ${res.status}`
    try {
      msg = (await res.text()) || msg
    } catch {
      /* 讀不到內容就用狀態碼 */
    }
    throw new CloudError(`照片伺服器：${msg}`, res.status)
  }
  return res
}

export type PhotoSize = 'thumb' | 'display'

export async function uploadPhotoBlob(id: string, size: PhotoSize, blob: Blob): Promise<void> {
  const res = await photoFetch(`photos/${encodeURIComponent(id)}/${size}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'image/jpeg' },
    body: blob,
  })
  if (res.status === 404) throw new CloudError('照片伺服器網址不對（404）', 404)
}

/** 下載照片；雲端沒有回傳 null */
export async function downloadPhotoBlob(id: string, size: PhotoSize): Promise<Blob | null> {
  const res = await photoFetch(`photos/${encodeURIComponent(id)}/${size}`)
  if (res.status === 404) return null
  return res.blob()
}

export async function deletePhotoBlobs(id: string): Promise<void> {
  await photoFetch(`photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 設定頁的「測試連線」 */
export async function checkPhotoServer(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${trimSlash(url)}/health`)
    return res.ok && (await res.text()).includes('ok')
  } catch {
    return false
  }
}
