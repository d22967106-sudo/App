import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { MapView, type MapMarker } from '../components/MapView'
import { PhotoImg, toast } from '../components/ui'
import { shareOrDownload } from '../lib/backup'
import { formatNumber, formatTwd } from '../lib/currency'
import {
  deleteTrip,
  getAllEntries,
  getAllTrack,
  getAllTrips,
  getEntriesInRange,
  getMeta,
  getStepsInRange,
  getTrackInRange,
  getTrip,
  newId,
  saveTrip,
  setMeta,
} from '../lib/db'
import { goBack, navigate, useLiveQuery, useObjectUrl } from '../lib/hooks'
import { getSyncStatus, missingTables, onSyncStatus } from '../lib/sync'
import { isDateKey, toDateKey } from '../lib/ledger'
import { renderPoster, type PosterBasemap, type PosterRatio } from '../lib/poster'
import { eachDate } from '../lib/stats'
import {
  dayColor,
  foreignText,
  formatTripRange,
  guessTripName,
  suggestionKey,
  suggestTrips,
  summarizeTrip,
  tripLength,
  type TripSummary,
} from '../lib/trips'
import type { GeoPoint, Trip } from '../lib/types'

const MAX_DAYS = 60
const DISMISSED_KEY = 'trip.dismissed'

export function TripPage({ path, query }: { path: string[]; query: URLSearchParams }) {
  if (!path.length) return <TripList />
  if (path[0] === 'new') return <TripEdit id={null} start={query.get('s')} end={query.get('e')} name={query.get('n')} />
  if (path[1] === 'edit') return <TripEdit id={path[0]} />
  if (path[1] === 'poster') return <PosterPage id={path[0]} />
  return <TripDetail id={path[0]} />
}

async function loadSummary(trip: Trip): Promise<TripSummary> {
  const [entries, track, steps] = await Promise.all([
    getEntriesInRange(trip.start, trip.end),
    getTrackInRange(trip.start, trip.end),
    getStepsInRange(trip.start, trip.end),
  ])
  return summarizeTrip(trip, entries, track, steps)
}

// ── 小小的軌跡縮圖 ──

function MiniRoute({ summary, size = 92 }: { summary: TripSummary; size?: number }) {
  const all = summary.days.flatMap((d) => d.route)
  if (!all.length) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <rect width={size} height={size} rx="14" fill="#EEDFCC" />
      </svg>
    )
  }
  const k = Math.cos((all[0].lat * Math.PI) / 180)
  const xs = all.map((p) => p.lng * k)
  const ys = all.map((p) => -p.lat)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1e-6)
  const inner = size - 28
  const offX = (inner - ((Math.max(...xs) - minX) / span) * inner) / 2 + 14
  const offY = (inner - ((Math.max(...ys) - minY) / span) * inner) / 2 + 14
  const pt = (p: GeoPoint) => `${(((p.lng * k - minX) / span) * inner + offX).toFixed(1)},${(((-p.lat - minY) / span) * inner + offY).toFixed(1)}`
  const [sx, sy] = pt(all[0]).split(',')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <rect width={size} height={size} rx="14" fill="#EEDFCC" />
      {summary.days.map((d) =>
        d.route.length > 1 ? (
          <polyline key={d.date} points={d.route.map(pt).join(' ')} fill="none" stroke={d.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        ) : null,
      )}
      <circle cx={sx} cy={sy} r="4.5" fill="#3A2618" />
    </svg>
  )
}

// ── 旅程列表 ──

function TripList() {
  const trips = useLiveQuery(async () => {
    const list = await getAllTrips()
    return Promise.all(list.map(async (trip) => ({ trip, summary: await loadSummary(trip) })))
  }, [])
  const [dismissed, setDismissed] = useState<string[] | null>(null)
  useEffect(() => {
    getMeta<string[]>(DISMISSED_KEY).then((d) => setDismissed(d ?? []))
  }, [])
  const suggestions = useLiveQuery(async () => {
    const [entries, track, list] = await Promise.all([getAllEntries(), getAllTrack(), getAllTrips()])
    return { entries, track, list }
  }, [])
  const suggest = useMemo(() => {
    if (!suggestions || !dismissed) return []
    return suggestTrips(suggestions.entries, suggestions.track, suggestions.list, dismissed, toDateKey(new Date()))
  }, [suggestions, dismissed])

  const [noCloudTable, setNoCloudTable] = useState(() => missingTables().includes('trips'))
  useEffect(() => onSyncStatus(() => setNoCloudTable(!getSyncStatus().running && missingTables().includes('trips'))), [])

  const dismiss = async (key: string) => {
    const next = [...(dismissed ?? []), key]
    setDismissed(next)
    await setMeta(DISMISSED_KEY, next)
  }

  return (
    <div className="page trip-page">
      <div className="page-head">
        <h1 className="big-title">旅程</h1>
        <button className="btn-primary trip-new-btn" onClick={() => navigate('trip/new')}>
          <Icon name="plus" size={18} strokeWidth={2.4} />
          建立旅程
        </button>
      </div>

      <div className="stack">
        {noCloudTable && (
          <button className="card settings-link" onClick={() => navigate('usage')}>
            <Icon name="cloud" size={20} />
            <span>
              <strong>旅程還沒同步到雲端</strong>
              <small>要先在 Supabase 執行一次設定 SQL，點這裡看怎麼做</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
        )}
        {suggest.slice(0, 2).map((s) => {
          const days = tripLength(s)
          const [, sm, sd] = s.start.split('-').map(Number)
          const [, em, ed] = s.end.split('-').map(Number)
          return (
            <section key={suggestionKey(s)} className="trip-suggest" aria-label="建議建立旅程">
              <div className="row1">
                <Icon name="pin" size={22} />
                <div>
                  <strong>
                    {sm}/{sd} – {em}/{ed} 你在{s.name === '旅程' ? '外地' : s.name}
                  </strong>
                  <span>這 {days} 天離家超過 50 公里，要建成一趟旅程嗎？</span>
                </div>
              </div>
              <div className="row2">
                <button className="btn-text" onClick={() => dismiss(suggestionKey(s))}>
                  不用
                </button>
                <button
                  className="btn-primary"
                  onClick={() => navigate(`trip/new?s=${s.start}&e=${s.end}${s.name === '旅程' ? '' : `&n=${encodeURIComponent(s.name)}`}`)}
                >
                  {s.name === '旅程' ? '建立旅程' : `建立「${s.name}」`}
                </button>
              </div>
            </section>
          )
        })}

        {trips?.length === 0 && !suggest.length && (
          <div className="placeholder">
            <Icon name="trip" size={40} />
            <h2>還沒有旅程</h2>
            <p>按「建立旅程」選一段日期；出遠門回來後，這裡也會自動建議。</p>
          </div>
        )}

        {trips?.map(({ trip, summary }) => (
          <a
            key={trip.id}
            className="trip-card"
            href={`#/trip/${trip.id}`}
            onClick={(e) => {
              e.preventDefault()
              navigate(`trip/${trip.id}`)
            }}
          >
            {trip.coverPhotoId ? (
              <span className="cover">
                <PhotoImg id={trip.coverPhotoId} />
              </span>
            ) : (
              <MiniRoute summary={summary} />
            )}
            <span className="info">
              <strong>{trip.name}</strong>
              <span className="muted">
                {formatTripRange(trip)} · {tripLength(trip)} 天
              </span>
              <span>
                {formatTwd(summary.expense)} · {formatNumber(Math.round(summary.km))} km · {summary.photos} 張照片
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── 建立／編輯旅程 ──

function TripEdit({ id, start: s0, end: e0, name: n0 }: { id: string | null; start?: string | null; end?: string | null; name?: string | null }) {
  const today = toDateKey(new Date())
  const [trip, setTrip] = useState<Trip | null>(null)
  const [moreCovers, setMoreCovers] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (id) {
      getTrip(id).then((t) => {
        if (t) setTrip(t)
        else navigate('trip', true)
      })
      return
    }
    const start = s0 && isDateKey(s0) ? s0 : today
    const end = e0 && isDateKey(e0) && e0 >= start ? e0 : start
    const now = Date.now()
    setTrip({ id: newId(), name: n0 ?? '', start, end, dayTitles: [], coverPhotoId: null, createdAt: now, updatedAt: now })
    if (!n0) getEntriesInRange(start, end).then((es) => setTrip((t) => (t && !t.name ? { ...t, name: guessTripName(es) === '旅程' ? '' : guessTripName(es) } : t)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const valid = !!trip && isDateKey(trip.start) && isDateKey(trip.end) && trip.start <= trip.end && tripLength(trip) <= MAX_DAYS
  const summary = useLiveQuery(async () => (trip && valid ? loadSummary(trip) : null), [trip?.start, trip?.end, valid])

  if (!trip) return <div className="page no-tabbar" />
  const days = valid ? eachDate(trip.start, trip.end) : []
  const set = (patch: Partial<Trip>) => setTrip({ ...trip, ...patch })

  const save = async () => {
    if (!valid) return
    setSaving(true)
    try {
      const name = trip.name.trim() || '旅程'
      await saveTrip({ ...trip, name, dayTitles: trip.dayTitles.slice(0, days.length), updatedAt: Date.now() })
      toast(id ? '已儲存' : `已建立「${name}」`)
      if (id) goBack(`trip/${trip.id}`)
      else navigate(`trip/${trip.id}`, true)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!id || !confirm(`刪除旅程「${trip.name}」？（裡面的紀錄和照片不會被刪掉）`)) return
    await deleteTrip(id)
    toast('已刪除旅程')
    navigate('trip', true)
  }

  const covers = summary?.photoIds ?? []
  const shownCovers = moreCovers ? covers : covers.slice(0, 4)

  return (
    <div className="page no-tabbar trip-edit">
      <div className="entry-head">
        <button className="btn-text" onClick={() => goBack(id ? `trip/${id}` : 'trip')}>
          取消
        </button>
        <h1>{id ? '編輯旅程' : '建立旅程'}</h1>
        <button className="btn-text strong" onClick={save} disabled={!valid || saving}>
          儲存
        </button>
      </div>

      <div className="stack">
        <section className="card stack">
          <div className="field">
            <label htmlFor="trip-name">名稱</label>
            <input id="trip-name" className="text-input" value={trip.name} placeholder="例如：京都" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div className="trip-dates">
            <div className="field">
              <label htmlFor="trip-start">開始</label>
              <input
                id="trip-start"
                type="date"
                className="text-input"
                value={trip.start}
                onChange={(e) => e.target.value && set({ start: e.target.value, end: e.target.value > trip.end ? e.target.value : trip.end })}
              />
            </div>
            <div className="field">
              <label htmlFor="trip-end">結束</label>
              <input id="trip-end" type="date" className="text-input" value={trip.end} min={trip.start} onChange={(e) => e.target.value && set({ end: e.target.value })} />
            </div>
          </div>
          {!valid ? (
            <p className="hint" style={{ color: 'var(--danger)' }}>
              {trip.start > trip.end ? '結束日期要在開始日期之後' : `一趟旅程最多 ${MAX_DAYS} 天`}
            </p>
          ) : (
            summary && (
              <p className="hint">
                {days.length} 天 · {summary.records} 筆紀錄、{summary.photos} 張照片、{summary.days.filter((d) => d.route.length > 1).length} 天有軌跡
              </p>
            )
          )}
        </section>

        {valid && (
          <section className="card stack">
            <h2 className="section-title" style={{ margin: 0 }}>
              每天的小標題 <span className="muted" style={{ fontWeight: 400 }}>（可不填）</span>
            </h2>
            {days.map((date, i) => (
              <div key={date} className="trip-day-title">
                <span className="dot" style={{ background: dayColor(i) }} />
                <span className="lbl">
                  Day {i + 1}
                  <small>
                    {Number(date.slice(5, 7))}/{Number(date.slice(8))}
                  </small>
                </span>
                <input
                  className="text-input"
                  aria-label={`Day ${i + 1} 小標題`}
                  value={trip.dayTitles[i] ?? ''}
                  placeholder={i === 0 ? '例如：抵達、東山' : ''}
                  onChange={(e) => {
                    const next = [...trip.dayTitles]
                    while (next.length < days.length) next.push('')
                    next[i] = e.target.value
                    set({ dayTitles: next })
                  }}
                />
              </div>
            ))}
          </section>
        )}

        {covers.length > 0 && (
          <section className="card stack">
            <h2 className="section-title" style={{ margin: 0 }}>
              封面照片
            </h2>
            <div className="trip-covers">
              {shownCovers.map((pid) => (
                <button
                  key={pid}
                  aria-label={trip.coverPhotoId === pid ? '封面（已選，再按一次取消）' : '選這張當封面'}
                  aria-pressed={trip.coverPhotoId === pid}
                  onClick={() => set({ coverPhotoId: trip.coverPhotoId === pid ? null : pid })}
                >
                  <PhotoImg id={pid} />
                </button>
              ))}
              {!moreCovers && covers.length > 4 && (
                <button className="more" onClick={() => setMoreCovers(true)}>
                  更多
                </button>
              )}
            </div>
            <span className="hint">不選就用軌跡縮圖</span>
          </section>
        )}

        {id && (
          <button className="btn-outline btn-danger" onClick={remove}>
            <Icon name="trash" size={18} />
            刪除這趟旅程
          </button>
        )}
      </div>
    </div>
  )
}

// ── 旅程地圖 ──

function TripDetail({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const trip = await getTrip(id)
    return trip ? { trip, summary: await loadSummary(trip) } : null
  }, [id])
  if (data === null) {
    return (
      <div className="page no-tabbar">
        <p className="muted">找不到這趟旅程</p>
        <button className="btn-outline" onClick={() => navigate('trip', true)}>
          回旅程列表
        </button>
      </div>
    )
  }
  if (!data) return <div className="page no-tabbar" />
  const { trip, summary } = data
  const first = summary.days.find((d) => d.route.length)?.route[0]
  const markers: MapMarker[] = first ? [{ id: 'start', lat: first.lat, lng: first.lng, kind: 'start', label: '起點' }] : []
  const maxDay = Math.max(...summary.days.map((d) => d.expense), 1)

  return (
    <div className="trip-detail">
      <div className="trip-map">
        <MapView
          route={[]}
          routes={summary.days.map((d) => ({ points: d.route, color: d.color }))}
          markers={markers}
          static={false}
          fallbackCenter={first ?? { lat: 23.6, lng: 120.9 }}
          topPadding={70}
          className="map-fill"
          ariaLabel={`${trip.name}的路線，每天一種顏色`}
        />
        <div className="topbar">
          <button className="round-btn" aria-label="返回旅程列表" onClick={() => goBack('trip')}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <div className="trip-pill">
            <strong>
              {trip.name} · {tripLength(trip)} 天
            </strong>
            <span>{formatTripRange(trip)}</span>
          </div>
          <button className="round-btn" aria-label="編輯旅程" onClick={() => navigate(`trip/${trip.id}/edit`)}>
            <Icon name="edit" size={18} />
          </button>
        </div>
      </div>

      <div className="trip-panel">
        <div className="trip-stats">
          <div>
            <span>總花費</span>
            <strong>{formatTwd(summary.expense)}</strong>
          </div>
          <div>
            <span>移動</span>
            <strong>{formatNumber(Math.round(summary.km))} km</strong>
          </div>
          <div>
            <span>照片</span>
            <strong>{summary.photos}</strong>
          </div>
          <div>
            <span>紀錄</span>
            <strong>{summary.records}</strong>
          </div>
        </div>
        {summary.foreign.length > 0 && <p className="hint">其中{foreignText(summary.foreign)}，依每筆當時匯率換算</p>}
        {summary.steps > 0 && <p className="hint">共走了 {formatNumber(summary.steps)} 步</p>}

        <div className="trip-days">
          {summary.days.map((d) => (
            <button key={d.date} onClick={() => navigate(`day/${d.date}`)} aria-label={`Day ${d.index + 1}${d.title ? ` ${d.title}` : ''}，支出 ${formatNumber(d.expense)}`}>
              <span className="dot" style={{ background: d.color }} />
              <span className="lbl">
                Day {d.index + 1}
                {d.title ? ` · ${d.title}` : ` · ${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}`}
              </span>
              <span className="bar">
                <span style={{ width: `${(d.expense / maxDay) * 100}%`, background: d.color }} />
              </span>
              <span className="amt">{formatNumber(d.expense)}</span>
            </button>
          ))}
        </div>

        <button className="btn-primary" onClick={() => navigate(`trip/${trip.id}/poster`)}>
          <Icon name="camera" size={20} />
          生成旅遊軌跡圖
        </button>
      </div>
    </div>
  )
}

// ── 生成旅遊軌跡圖 ──

function PosterPage({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const trip = await getTrip(id)
    return trip ? { trip, summary: await loadSummary(trip) } : null
  }, [id])
  const [ratio, setRatio] = useState<PosterRatio>('4:5')
  const [basemap, setBasemap] = useState<PosterBasemap>('tea')
  const [showMoney, setShowMoney] = useState(true)
  const [showNames, setShowNames] = useState(true)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const url = useObjectUrl(blob)

  useEffect(() => {
    if (!data) return
    let alive = true
    setBusy(true)
    const { trip, summary } = data
    renderPoster({
      name: trip.name,
      start: trip.start,
      end: trip.end,
      days: summary.days.map((d) => ({ color: d.color, route: d.route, landmark: d.landmark })),
      stats: { km: summary.km, places: summary.places, photos: summary.photos, expense: summary.expense, steps: summary.steps },
      ratio,
      basemap,
      showMoney,
      showNames,
    })
      .then((r) => {
        if (!alive) return
        setBlob(r.blob)
        if (r.used !== basemap) {
          if (r.used !== 'none') setBasemap(r.used)
          toast(r.used === 'osm' ? '奶茶淡色地圖載入失敗，先改用「淡色地圖」' : '地圖載入失敗，這次先只畫路線（有網路時再試一次）', 4000)
        }
      })
      .catch((e) => alive && toast('產生圖片失敗：' + (e as Error).message, 4000))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
  }, [data, ratio, basemap, showMoney, showNames])

  if (data === null) return <div className="page no-tabbar"><p className="muted">找不到這趟旅程</p></div>
  const name = data?.trip.name ?? ''

  return (
    <div className="page no-tabbar poster-page">
      <div className="entry-head">
        <button className="round-btn" aria-label="返回" onClick={() => goBack(`trip/${id}`)}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <h1>旅遊軌跡圖</h1>
        <span style={{ width: 44 }} />
      </div>

      <div className={`poster-preview r${ratio.replace(':', '')}`}>
        {url && <img src={url} alt={`${name}旅遊軌跡圖預覽`} />}
        {busy && <span className="spinner" />}
      </div>

      <section className="card stack poster-options">
        <div className="kv">
          <span>比例</span>
          <div className="segmented small two" role="group" aria-label="比例">
            <button aria-pressed={ratio === '4:5'} onClick={() => setRatio('4:5')}>
              4:5 貼文
            </button>
            <button aria-pressed={ratio === '9:16'} onClick={() => setRatio('9:16')}>
              9:16 限動
            </button>
          </div>
        </div>
        <div className="kv">
          <span>底圖</span>
          <div className="segmented small two" role="group" aria-label="底圖">
            <button aria-pressed={basemap === 'tea'} onClick={() => setBasemap('tea')}>
              奶茶淡色地圖
            </button>
            <button aria-pressed={basemap === 'osm'} onClick={() => setBasemap('osm')}>
              淡色地圖
            </button>
          </div>
        </div>
        <label className="kv">
          <span>顯示花費</span>
          <input type="checkbox" checked={showMoney} onChange={(e) => setShowMoney(e.target.checked)} />
        </label>
        <label className="kv">
          <span>顯示地名</span>
          <input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
        </label>
      </section>

      <button className="btn-primary" disabled={!blob || busy} onClick={() => blob && shareOrDownload(blob, `${name}-旅遊軌跡圖.png`)}>
        <Icon name="share" size={20} />
        分享／儲存到照片
      </button>
      <p className="hint" style={{ textAlign: 'center' }}>
        分享選單裡選「儲存影像」就會存進相簿
      </p>
    </div>
  )
}
