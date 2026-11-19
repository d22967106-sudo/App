import { useCallback, useEffect, useState } from 'react'
import phase4Sql from '../../supabase/phase4.sql?raw'
import { Icon } from '../components/Icon'
import { toast } from '../components/ui'
import { CloudError, fetchPhotoUsage, rest } from '../lib/cloud'
import { cacheUsage, localCounts } from '../lib/db'
import { goBack } from '../lib/hooks'
import { parseDateKey } from '../lib/ledger'
import { cloudReady } from '../lib/sync'
import { DB_LIMIT, formatBytes, PHOTO_LIMIT, yearsLeft, yearsText } from '../lib/usage'

interface DbUsage {
  db_bytes: number
  tables: Record<string, { rows: number; bytes: number }>
}

interface State {
  cloud: boolean
  db: DbUsage | 'need-sql' | string | null
  photos: { bytes: number; objects: number; complete: boolean } | 'old-worker' | string | null
  local: Awaited<ReturnType<typeof localCounts>>
  cache: { count: number; bytes: number }
  phone: number | null
}

const TABLE_NAMES: [string, string][] = [
  ['entries', '紀錄'],
  ['track_points', '軌跡點'],
  ['photos', '照片'],
  ['summaries', '每日總結'],
  ['daily_steps', '步數'],
  ['trips', '旅程'],
  ['places', '記住的店'],
]

const daysSince = (ms: number) => Math.max(1, Math.round((Date.now() - ms) / 86400000))

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast('已複製設定 SQL')
  } catch {
    toast('複製失敗，請再試一次')
  }
}

function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100)
  return (
    <div className="meter" role="img" aria-label={`已用 ${pct.toFixed(1)}%`}>
      <span style={{ width: `${Math.max(pct, 0.5)}%` }} />
    </div>
  )
}

/** 使用狀況：雲端資料庫、照片空間、手機上的資料 */
export function UsagePage() {
  const [st, setSt] = useState<State | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [local, cache, est, cloud] = await Promise.all([
        localCounts(),
        cacheUsage(),
        navigator.storage?.estimate?.().catch(() => null) ?? null,
        cloudReady(),
      ])
      let db: State['db'] = null
      let photos: State['photos'] = null
      if (cloud) {
        await Promise.all([
          rest('rpc/usage_stats', { method: 'POST', body: '{}' })
            .then(async (r) => (db = (await r.json()) as DbUsage))
            .catch((e) => (db = e instanceof CloudError && (e.status === 404 || /找不到資料表|usage_stats/.test(e.message)) ? 'need-sql' : String((e as Error).message))),
          fetchPhotoUsage()
            .then((r) => (photos = r ?? 'old-worker'))
            .catch((e) => (photos = (e as Error).message)),
        ])
      }
      setSt({ cloud, db, photos, local, cache, phone: est?.usage ?? null })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const firstMs = st?.local.firstDate ? parseDateKey(st.local.firstDate).getTime() : null
  const db = st?.db && typeof st.db === 'object' ? st.db : null
  const photos = st?.photos && typeof st.photos === 'object' ? st.photos : null
  const tableBytes = db ? Object.values(db.tables).reduce((n, t) => n + t.bytes, 0) : 0

  return (
    <div className="page no-tabbar usage-page">
      <div className="entry-head">
        <button className="round-btn" aria-label="返回設定" onClick={() => goBack('settings')}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <h1>使用狀況</h1>
        <button className="round-btn" aria-label="重新整理" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={18} />}
        </button>
      </div>

      {st && (
        <div className="stack">
          {!st.cloud && (
            <section className="card">
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                還沒登入雲端，下面只有手機上的資料。
              </p>
            </section>
          )}

          {st.cloud && (
            <section className="card stack" aria-label="雲端資料庫">
              <h2 className="section-title" style={{ margin: 0 }}>
                雲端資料庫（Supabase 免費 500 MB）
              </h2>
              {st.db === 'need-sql' ? (
                <>
                  <p className="hint" style={{ margin: 0 }}>
                    要先在 Supabase 執行一次第 4 階段的設定 SQL（同時會建立「旅程」的雲端資料表）：按下面的按鈕複製，到 Supabase 後台 → SQL Editor → New
                    query，貼上後按 Run，看到 Success 後回來按右上角重新整理。
                  </p>
                  <button className="btn-outline" onClick={() => copy(phase4Sql)}>
                    <Icon name="copy" size={18} />
                    複製設定 SQL
                  </button>
                </>
              ) : typeof st.db === 'string' ? (
                <p className="hint" style={{ margin: 0, color: 'var(--danger)' }}>
                  讀不到：{st.db}
                </p>
              ) : db ? (
                <>
                  <div className="usage-big">
                    <strong>{formatBytes(db.db_bytes)}</strong>
                    <span> / 500 MB</span>
                  </div>
                  <Meter used={db.db_bytes} limit={DB_LIMIT} />
                  <p className="hint" style={{ margin: 0 }}>
                    {yearsText(firstMs ? yearsLeft(db.db_bytes, DB_LIMIT, tableBytes, daysSince(firstMs)) : null)}
                  </p>
                  <div className="usage-table">
                    {TABLE_NAMES.filter(([t]) => db.tables[t]).map(([t, name]) => (
                      <div key={t} className="kv">
                        <span>{name}</span>
                        <span>
                          {db.tables[t].rows.toLocaleString('zh-TW')} 筆 · {formatBytes(db.tables[t].bytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="hint" style={{ margin: 0 }}>
                    總大小含資料庫本身的固定開銷（約十幾 MB），所以會比各表加起來大。
                  </p>
                </>
              ) : null}
            </section>
          )}

          {st.cloud && (
            <section className="card stack" aria-label="照片空間">
              <h2 className="section-title" style={{ margin: 0 }}>
                照片空間（Cloudflare R2 免費 10 GB）
              </h2>
              {st.photos === 'old-worker' ? (
                <p className="hint" style={{ margin: 0 }}>
                  照片伺服器還是舊版本：新版發布後會自動更新，過幾分鐘再按右上角重新整理。
                </p>
              ) : typeof st.photos === 'string' ? (
                <p className="hint" style={{ margin: 0, color: 'var(--danger)' }}>
                  讀不到：{st.photos}
                </p>
              ) : photos ? (
                <>
                  <div className="usage-big">
                    <strong>{formatBytes(photos.bytes)}</strong>
                    <span> / 10 GB</span>
                  </div>
                  <Meter used={photos.bytes} limit={PHOTO_LIMIT} />
                  <p className="hint" style={{ margin: 0 }}>
                    {yearsText(st.local.firstPhotoAt ? yearsLeft(photos.bytes, PHOTO_LIMIT, photos.bytes, daysSince(st.local.firstPhotoAt)) : null)}
                  </p>
                  <div className="kv">
                    <span>檔案數</span>
                    <span>
                      {photos.objects.toLocaleString('zh-TW')} 個（每張照片有縮圖和大圖兩個）{photos.complete ? '' : '以上'}
                    </span>
                  </div>
                </>
              ) : null}
            </section>
          )}

          <section className="card stack" aria-label="這支手機">
            <h2 className="section-title" style={{ margin: 0 }}>
              這支手機
            </h2>
            {st.phone != null && (
              <div className="kv">
                <span>App 使用的空間</span>
                <span>{formatBytes(st.phone)}</span>
              </div>
            )}
            <div className="kv">
              <span>大圖暫存</span>
              <span>
                {st.cache.count} 張 · {formatBytes(st.cache.bytes)}
              </span>
            </div>
            <div className="kv">
              <span>紀錄</span>
              <span>{st.local.entries.toLocaleString('zh-TW')} 筆</span>
            </div>
            <div className="kv">
              <span>軌跡點</span>
              <span>{st.local.track.toLocaleString('zh-TW')} 個</span>
            </div>
            <div className="kv">
              <span>照片</span>
              <span>{st.local.photos.toLocaleString('zh-TW')} 張</span>
            </div>
            <div className="kv">
              <span>旅程</span>
              <span>{st.local.trips} 趟</span>
            </div>
            {st.local.firstDate && (
              <div className="kv">
                <span>最早的資料</span>
                <span>{st.local.firstDate}</span>
              </div>
            )}
          </section>

          <p className="hint" style={{ textAlign: 'center' }}>
            流量、請求次數要用管理金鑰才查得到，所以這裡不顯示。
          </p>
        </div>
      )}
    </div>
  )
}
