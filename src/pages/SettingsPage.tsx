import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { MapStylePicker } from '../components/MapStylePicker'
import { toast } from '../components/ui'
import { buildBackup, restoreBackup, shareOrDownload } from '../lib/backup'
import { buildLocalSettings, restoreLocalSettings } from '../lib/localSettings'
import { getAllEntries, requestPersistentStorage } from '../lib/db'
import { goBack, navigate, useLiveQuery } from '../lib/hooks'
import { onCloudChange } from '../lib/cloud'
import { usePhotoQuotaMessage } from '../lib/photoQuota'
import { cloudReady } from '../lib/sync'
import { AutomationSection } from './AutomationSection'
import { TRAVEL_MODES, type TravelMode } from '../lib/legs'
import { getRouteSettings, onRouteSettingsChange, saveRouteSettings, type RouteSettings } from '../lib/snap'
import { CloudSection } from './CloudSection'

/** 設定：雲端同步、自動化、地圖樣式、使用狀況、備份（從統計頁右上齒輪進來） */
export function SettingsPage() {
  const entries = useLiveQuery(() => getAllEntries(), [])
  const quotaMsg = usePhotoQuotaMessage()
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const localRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
    navigator.storage
      ?.estimate?.()
      .then((e) => e.usage != null && setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`))
      .catch(() => {})
  }, [entries])

  const [withCloud, setWithCloud] = useState(false)
  const [progress, setProgress] = useState('')
  const [cloudOn, setCloudOn] = useState(false)
  useEffect(() => {
    const load = () => {
      cloudReady().then(setCloudOn)
    }
    load()
    return onCloudChange(load)
  }, [])

  const doExport = async () => {
    setBusy('export')
    try {
      const { blob, filename, counts } = await buildBackup({
        withCloudPhotos: withCloud,
        onProgress: withCloud ? (d, t) => setProgress(`照片 ${d}/${t}`) : undefined,
      })
      setProgress('')
      await shareOrDownload(blob, filename)
      toast(`已匯出 ${counts.entries} 筆紀錄、${counts.photos} 張照片`)
    } catch (e) {
      setProgress('')
      toast('匯出失敗：' + (e as Error).message, 4000)
    } finally {
      setBusy(null)
    }
  }

  const doImport = async (file: File | undefined) => {
    if (!file) return
    if (!confirm('匯入備份會加入（或覆蓋同一筆）紀錄，現有的其他資料會保留。要繼續嗎？')) return
    setBusy('import')
    try {
      const r = await restoreBackup(file)
      toast(`已匯入 ${r.entries} 筆紀錄、${r.photos} 張照片`)
    } catch (e) {
      toast('匯入失敗：' + (e as Error).message, 5000)
    } finally {
      setBusy(null)
    }
  }

  // 本機設定（雲端登入、自動化金鑰、路線修改…）：刪掉主畫面 App 重新加入前先匯出，加入後匯入
  const exportLocal = async () => {
    try {
      const data = await buildLocalSettings()
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = `摳摳手帳-本機設定-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`
      await shareOrDownload(new Blob([JSON.stringify(data)], { type: 'application/json' }), name)
      toast(`已匯出 ${Object.keys(data.meta).length} 項設定`)
    } catch (e) {
      toast('匯出失敗：' + (e as Error).message, 4000)
    }
  }
  const importLocal = async (file: File | undefined) => {
    if (!file) return
    if (!confirm('匯入本機設定會覆蓋這支手機上的雲端登入、自動化金鑰、路線修改等設定。要繼續嗎？')) return
    try {
      const n = await restoreLocalSettings(await file.text())
      toast(`已匯入 ${n} 項設定，重新載入中…`, 2500)
      setTimeout(() => location.reload(), 1200)
    } catch (e) {
      toast('匯入失敗：' + (e as Error).message, 5000)
    }
  }

  return (
    <div className="page no-tabbar">
      <div className="entry-head">
        <button className="round-btn" aria-label="返回統計" onClick={() => goBack('stats')}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <h1>設定</h1>
        <span style={{ width: 44 }} />
      </div>

      <div className="stack">
        <button className="card settings-link" onClick={() => navigate('usage')}>
          <Icon name="stats" size={20} />
          <span>
            <strong>使用狀況</strong>
            {quotaMsg ? <small className="quota-text">{quotaMsg}</small> : <small>雲端資料庫、照片空間還剩多少</small>}
          </span>
          <Icon name="chevronRight" size={18} />
        </button>

        <CloudSection />

        <AutomationSection />

        <RouteSection />

        <section className="card" aria-label="地圖樣式">
          <h2 className="section-title">地圖樣式</h2>
          <MapStylePicker />
        </section>

        <section className="card stack" aria-label="資料與備份">
          <h2 className="section-title" style={{ margin: 0 }}>
            資料與備份
          </h2>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {cloudOn
              ? '資料已同步到雲端。也可以另外匯出一份備份（zip 檔，內含 data.json 與照片），存到「檔案」或 iCloud。'
              : '目前資料只存在這支手機上。建議定期匯出備份（一個 zip 檔，內含 data.json 與照片），存到「檔案」或 iCloud。'}
          </p>
          {cloudOn && (
            <label className="kv" style={{ fontSize: 14 }}>
              <span>
                包含雲端上的大圖
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  要逐張下載，照片多時檔案很大、比較久；不勾只放縮圖和手機上有的大圖
                </span>
              </span>
              <input type="checkbox" checked={withCloud} onChange={(e) => setWithCloud(e.target.checked)} style={{ width: 22, height: 22 }} />
            </label>
          )}
          <button className="btn-outline" onClick={doExport} disabled={busy != null}>
            {busy === 'export' ? <span className="spinner" /> : <Icon name="download" size={18} />}
            {progress || '匯出全部資料'}
          </button>
          <button className="btn-outline" onClick={() => fileRef.current?.click()} disabled={busy != null}>
            {busy === 'import' ? <span className="spinner" /> : <Icon name="upload" size={18} />}
            從備份匯入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              doImport(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <h3 className="section-title" style={{ margin: '8px 0 0', fontSize: 15 }}>
            本機設定
          </h3>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            雲端登入、自動化金鑰、路線的手繪修改／切段／交通方式、地圖樣式、預算只存在這支手機上（上面的「匯出全部資料」不含這些）。
            要刪掉主畫面上的 App 重新加入前，先匯出這個檔案；重新加入後再匯入，就不用重新設定。檔案裡有金鑰和登入狀態，等同密碼，不要傳給別人，用完可以刪掉。
          </p>
          <button className="btn-outline" onClick={exportLocal} disabled={busy != null}>
            <Icon name="download" size={18} />
            匯出本機設定
          </button>
          <button className="btn-outline" onClick={() => localRef.current?.click()} disabled={busy != null}>
            <Icon name="upload" size={18} />
            匯入本機設定
          </button>
          <input
            ref={localRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              importLocal(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <div className="kv">
            <span>全部紀錄</span>
            <span>{entries?.length ?? '—'} 筆</span>
          </div>
          {usage && (
            <div className="kv">
              <span>手機上使用空間</span>
              <span>{usage}</span>
            </div>
          )}
          <div className="kv">
            <span>防止系統清除資料</span>
            {persisted ? (
              <span>已開啟</span>
            ) : (
              <button
                className="btn-text"
                style={{ minHeight: 32, fontSize: 14, color: 'var(--primary)' }}
                onClick={async () => {
                  const ok = await requestPersistentStorage()
                  setPersisted(ok)
                  toast(ok ? '已開啟' : '瀏覽器沒有同意，請先「加入主畫面」再試')
                }}
              >
                開啟
              </button>
            )}
          </div>
        </section>

        <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
          摳摳手帳 · 第 4 階段 · {__BUILD_DATE__}
        </p>
      </div>
    </div>
  )
}

/** 路線：貼齊道路、預設交通方式 */
function RouteSection() {
  const [st, setSt] = useState<RouteSettings | null>(null)
  useEffect(() => {
    const load = () => getRouteSettings().then(setSt)
    load()
    return onRouteSettingsChange(load)
  }, [])
  if (!st) return null
  return (
    <section className="card stack" aria-label="路線">
      <h2 className="section-title" style={{ margin: 0 }}>
        路線
      </h2>
      <label className="kv" style={{ alignItems: 'center' }}>
        <span>
          貼齊道路
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
            把背景定位的路線吸附到真正的道路上；關掉就畫原本的直線
          </span>
        </span>
        <input type="checkbox" checked={st.snap} onChange={(e) => saveRouteSettings({ snap: e.target.checked })} style={{ width: 22, height: 22 }} />
      </label>
      <label className="kv" style={{ alignItems: 'center' }}>
        <span>預設交通方式</span>
        <select className="text-input" style={{ width: 'auto', minHeight: 36 }} value={st.mode} onChange={(e) => saveRouteSettings({ mode: e.target.value as TravelMode })}>
          {TRAVEL_MODES.filter((m) => m.id !== 'none').map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="kv" style={{ alignItems: 'center' }}>
        <span>
          顯示原始定位點
          <span className="muted" style={{ display: 'block', fontSize: 12 }}>
            除錯用：地圖上用藍色小點標出 Overland 送來的每一個點（灰色＝精確度太差沒採用），點一下看時間與精確度。路線少一段時，有點＝App 沒畫出來，沒點＝Overland 沒記到
          </span>
        </span>
        <input type="checkbox" checked={st.rawPoints} onChange={(e) => saveRouteSettings({ rawPoints: e.target.checked })} style={{ width: 22, height: 22 }} />
      </label>
      <p className="hint" style={{ margin: 0 }}>
        很慢的路段自動當走路、很快的（火車、高鐵）不貼齊；每一段也可以在地圖上點開後自己改。比對用 OpenStreetMap 社群的免費服務（FOSSGIS 的 Valhalla），每段只送一次、結果存在手機上；連不上時先畫直線。
      </p>
    </section>
  )
}
