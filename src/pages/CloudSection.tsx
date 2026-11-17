import { useEffect, useState, useSyncExternalStore } from 'react'
import { Icon } from '../components/Icon'
import { toast } from '../components/ui'
import {
  checkPhotoServer,
  getConfig,
  getSession,
  getSettings,
  normalizeConfig,
  onCloudChange,
  saveConfig,
  saveSettings,
  sendLoginCode,
  signOut,
  validateConfig,
  verifyLoginCode,
  type CloudConfig,
  type CloudSession,
  type CloudSettings,
} from '../lib/cloud'
import { cacheClear, cacheTrim, cacheUsage } from '../lib/db'
import { formatDateTimeShort } from '../lib/ledger'
import { getSyncStatus, onSyncStatus, refreshPending, syncNow } from '../lib/sync'

const GUIDE_URL = 'https://github.com/d22967106-sudo/App/blob/claude/start-phase-two-wqljng/docs/setup-cloud.md'

function useCloudState() {
  const [state, setState] = useState<{ cfg: CloudConfig | null; session: CloudSession | null; settings: CloudSettings }>()
  useEffect(() => {
    const load = async () => setState({ cfg: await getConfig(), session: await getSession(), settings: await getSettings() })
    load()
    return onCloudChange(load)
  }, [])
  return state
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** 「統計與設定」裡的雲端同步區塊 */
export function CloudSection() {
  const st = useCloudState()
  const [editing, setEditing] = useState(false)
  if (!st) return null
  const { cfg, session, settings } = st
  return (
    <section className="card stack" aria-label="雲端同步">
      <h2 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="cloud" size={18} />
        雲端同步
      </h2>
      {!cfg || editing ? (
        <ConfigForm initial={cfg} onDone={() => setEditing(false)} canCancel={!!cfg} />
      ) : !session ? (
        <LoginForm onEditConfig={() => setEditing(true)} />
      ) : (
        <SyncPanel session={session} cfg={cfg} settings={settings} onEditConfig={() => setEditing(true)} />
      )}
    </section>
  )
}

function ConfigForm({ initial, onDone, canCancel }: { initial: CloudConfig | null; onDone: () => void; canCancel: boolean }) {
  const [url, setUrl] = useState(initial?.url ?? '')
  const [key, setKey] = useState(initial?.key ?? '')
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const c = normalizeConfig({ url, key, photoUrl })
    const err = validateConfig(c)
    if (err) return setError(err)
    setBusy(true)
    setError('')
    if (c.photoUrl && !(await checkPhotoServer(c.photoUrl))) {
      setBusy(false)
      if (!confirm('照片伺服器測試連線失敗（網址不對，或 Worker 還沒設定好）。仍要儲存嗎？')) return
    }
    await saveConfig(c)
    setBusy(false)
    toast('已儲存雲端設定')
    onDone()
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        設定好之後，資料會先存在手機，有網路時自動備份到你自己的 Supabase；照片放在你自己的 Cloudflare R2。
        還沒註冊的話，照{' '}
        <a href={GUIDE_URL} target="_blank" rel="noreferrer">
          設定教學
        </a>{' '}
        一步一步做。
      </p>
      <div className="field">
        <label htmlFor="cl-url">Supabase 網址（Project URL）</label>
        <input id="cl-url" className="text-input" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="https://abcd.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cl-key">Supabase 公開金鑰（anon 或 publishable key）</label>
        <textarea id="cl-key" rows={3} autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="eyJ… 或 sb_publishable_…" value={key} onChange={(e) => setKey(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cl-photo">照片伺服器網址（Cloudflare Worker，可以晚點再填）</label>
        <input id="cl-photo" className="text-input" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          placeholder="https://ledger-photos.xxx.workers.dev" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <button className="btn-primary" onClick={save} disabled={busy}>
        {busy ? <span className="spinner" /> : null}
        儲存
      </button>
      {canCancel && (
        <button className="btn-text" onClick={onDone}>
          取消
        </button>
      )}
    </>
  )
}

function LoginForm({ onEditConfig }: { onEditConfig: () => void }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('請輸入正確的電子郵件')
    setBusy(true)
    setError('')
    try {
      await sendLoginCode(email)
      setSent(true)
      toast('驗證碼已寄出，請到信箱查看')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!/^\d{6,10}$/.test(code.replace(/\s/g, ''))) return setError('請輸入信裡的數字驗證碼')
    setBusy(true)
    setError('')
    try {
      await verifyLoginCode(email, code)
      toast('登入成功，開始同步')
      syncNow()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        用電子郵件登入：App 會寄一組數字驗證碼到信箱，複製回來貼上就好（不用密碼）。
      </p>
      <div className="field">
        <label htmlFor="cl-email">電子郵件</label>
        <input id="cl-email" className="text-input" type="email" autoComplete="email" autoCapitalize="off"
          value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent && busy} />
      </div>
      {sent && (
        <div className="field">
          <label htmlFor="cl-code">驗證碼</label>
          <input id="cl-code" className="text-input" inputMode="numeric" autoComplete="one-time-code"
            placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
      {sent ? (
        <>
          <button className="btn-primary" onClick={verify} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            登入
          </button>
          <button className="btn-text" onClick={send} disabled={busy}>
            重新寄驗證碼
          </button>
        </>
      ) : (
        <button className="btn-primary" onClick={send} disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          寄驗證碼
        </button>
      )}
      <button className="btn-text" onClick={onEditConfig}>
        修改雲端設定
      </button>
    </>
  )
}

function SyncPanel({
  session,
  cfg,
  settings,
  onEditConfig,
}: {
  session: CloudSession
  cfg: CloudConfig
  settings: CloudSettings
  onEditConfig: () => void
}) {
  const status = useSyncExternalStore(onSyncStatus, getSyncStatus)
  const [cache, setCache] = useState<{ count: number; bytes: number }>()
  const loadCache = () => cacheUsage().then(setCache)
  useEffect(() => {
    refreshPending()
    loadCache()
  }, [status.lastSyncAt])

  return (
    <>
      <div className="kv">
        <span>帳號</span>
        <span style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>{session.email}</span>
      </div>
      <div className="kv">
        <span>上次同步</span>
        <span>{status.running ? '同步中…' : status.lastSyncAt ? formatDateTimeShort(status.lastSyncAt) : '還沒同步'}</span>
      </div>
      <div className="kv">
        <span>待上傳</span>
        <span>{status.pending} 筆</span>
      </div>
      {status.lastError && (
        <p className="error-text" role="alert" style={{ margin: 0 }}>
          {status.lastError}
        </p>
      )}
      {!cfg.photoUrl && (
        <p className="hint" style={{ margin: 0 }}>
          還沒設定照片伺服器：文字資料會同步，照片先留在手機上，設定好之後會補傳。
        </p>
      )}
      {status.photosPaused > 0 && cfg.photoUrl && (
        <p className="hint" style={{ margin: 0 }}>
          有 {status.photosPaused} 張照片因為「暫停照片上傳」還留在手機上。
        </p>
      )}
      <button className="btn-outline" onClick={() => syncNow()} disabled={status.running}>
        {status.running ? <span className="spinner" /> : <Icon name="refresh" size={18} />}
        立即同步
      </button>

      <div className="kv">
        <label htmlFor="cl-pause" style={{ flex: 1 }}>
          暫停照片上傳
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
            出國用行動網路時可以打開（iPhone 的網頁 App 偵測不到是不是 Wi-Fi，要手動切換）
          </span>
        </label>
        <input id="cl-pause" type="checkbox" checked={settings.pausePhotoUpload} style={{ width: 22, height: 22 }}
          onChange={async (e) => {
            await saveSettings({ pausePhotoUpload: e.target.checked })
            if (!e.target.checked) syncNow()
          }} />
      </div>

      <div className="kv">
        <label htmlFor="cl-cache">大圖暫存上限</label>
        <select id="cl-cache" className="text-input" style={{ width: 'auto', padding: '6px 10px' }} value={settings.cacheLimitMB}
          onChange={async (e) => {
            const v = Number(e.target.value)
            await saveSettings({ cacheLimitMB: v })
            await cacheTrim(v * 1024 * 1024)
            loadCache()
          }}>
          {[100, 200, 500, 1000, 2000].map((v) => (
            <option key={v} value={v}>
              {v >= 1000 ? `${v / 1000} GB` : `${v} MB`}
            </option>
          ))}
        </select>
      </div>
      {cache && (
        <div className="kv">
          <span>大圖暫存</span>
          <span>
            {cache.count} 張 · {mb(cache.bytes)}{' '}
            {cache.count > 0 && (
              <button className="btn-text" style={{ minHeight: 32, fontSize: 14, color: 'var(--primary)' }}
                onClick={async () => {
                  if (!confirm('清除手機上暫存的大圖？雲端的照片不受影響，之後點開會重新下載。')) return
                  await cacheClear()
                  loadCache()
                }}>
                清除
              </button>
            )}
          </span>
        </div>
      )}

      <button className="btn-text" onClick={onEditConfig}>
        修改雲端設定
      </button>
      <button className="btn-text" onClick={async () => {
          const msg = status.pending
            ? `還有 ${status.pending} 筆沒上傳，登出後會留在手機上，下次登入再傳。要登出嗎？`
            : '要登出嗎？手機上的資料會保留。'
          if (confirm(msg)) await signOut()
        }}>
        登出
      </button>
    </>
  )
}
