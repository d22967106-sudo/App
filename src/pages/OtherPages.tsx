import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../components/Icon'
import { MapStylePicker } from '../components/MapStylePicker'
import { toast } from '../components/ui'
import { buildBackup, restoreBackup, shareOrDownload } from '../lib/backup'
import { formatTwd } from '../lib/currency'
import { getAllEntries, requestPersistentStorage } from '../lib/db'
import { navigate, useLiveQuery } from '../lib/hooks'
import { toDateKey, totalTwd } from '../lib/ledger'
import { onCloudChange } from '../lib/cloud'
import { cloudReady } from '../lib/sync'
import { AutomationSection } from './AutomationSection'
import { CloudSection } from './CloudSection'

function Placeholder({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <div className="placeholder">
      <Icon name={icon} size={40} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  )
}

export function CalendarPage() {
  const today = toDateKey(new Date())
  return (
    <div className="page">
      <div className="page-head">
        <h1>日曆</h1>
      </div>
      <Placeholder icon="calendar" title="日曆頁之後會加入" text="第 4 階段會做月曆檢視。現在可以先選日期跳到那一天。" />
      <div className="field">
        <label htmlFor="jump">跳到日期</label>
        <input
          id="jump"
          type="date"
          className="text-input"
          max={today}
          defaultValue={today}
          onChange={(e) => e.target.value && navigate(`map?d=${e.target.value}`, true)}
        />
      </div>
    </div>
  )
}

export function TripPage() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>旅程</h1>
      </div>
      <Placeholder icon="trip" title="旅程之後會加入" text="第 4 階段會做旅程地圖與旅遊軌跡圖。現在記下的紀錄之後都能用。" />
    </div>
  )
}

export function StatsPage() {
  const entries = useLiveQuery(() => getAllEntries(), [])
  const month = toDateKey(new Date()).slice(0, 7)
  const monthEntries = entries?.filter((e) => e.date.startsWith(month)) ?? []
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [usage, setUsage] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

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

  return (
    <div className="page">
      <div className="page-head">
        <h1>統計與設定</h1>
      </div>

      <div className="stack">
        <section className="card" aria-label="本月">
          <h2 className="section-title">本月</h2>
          <div className="kv">
            <span>支出</span>
            <strong>{formatTwd(totalTwd(monthEntries, 'expense'))}</strong>
          </div>
          <div className="kv">
            <span>收入</span>
            <strong>{formatTwd(totalTwd(monthEntries, 'income'))}</strong>
          </div>
          <div className="kv">
            <span>紀錄</span>
            <strong>{monthEntries.length} 筆</strong>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>
            每日／每月／分類的完整統計會在第 4 階段加入。
          </p>
        </section>

        <CloudSection />

        <AutomationSection />

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
          記帳日記 · 第 3 階段 · {__BUILD_DATE__}
        </p>
      </div>
    </div>
  )
}
