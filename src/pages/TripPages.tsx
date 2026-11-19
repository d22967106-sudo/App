import { useEffect, useMemo, useRef, useState } from 'react'
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
import { isDateKey, shiftDate, toDateKey } from '../lib/ledger'
import { canRecordVideo, recordVideo, renderPoster, type PosterBasemap, type PosterInput, type PosterRatio, type VideoResult } from '../lib/poster'
import {
  dayColor,
  dayDashed,
  foreignText,
  formatTripRange,
  guessTripName,
  mergeTrips,
  normalizeSegments,
  titlesByDate,
  tripDates,
  tripDaysText,
  tripSegments,
  suggestionKey,
  suggestTrips,
  summarizeTrip,
  tripLength,
  type TripSummary,
} from '../lib/trips'
import type { GeoPoint, Trip, TripSegment } from '../lib/types'

const MAX_DAYS = 90
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

/** 每天的顏色點；虛線的日子畫成虛線圈 */
function DayDot({ color, dashed }: { color: string; dashed: boolean }) {
  return <span className="dot" style={dashed ? { border: `2px dashed ${color}`, background: 'transparent' } : { background: color }} />
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
          <polyline key={d.date} points={d.route.map(pt).join(' ')} fill="none" stroke={d.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={d.dashed ? '5 4' : undefined} />
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
                {formatTripRange(trip)} · {tripDaysText(trip)}
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
  /** 自己的日期段（編輯中，可能暫時不合法） */
  const [segs, setSegs] = useState<TripSegment[]>([])
  /** 每天的小標題（用日期當 key） */
  const [titles, setTitles] = useState<Record<string, string>>({})
  /** 要併進來的其他旅程（儲存時把它們刪掉） */
  const [mergeIds, setMergeIds] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const [moreCovers, setMoreCovers] = useState(false)
  const [saving, setSaving] = useState(false)
  const others = useLiveQuery(async () => (await getAllTrips()).filter((t) => t.id !== id), [id])

  useEffect(() => {
    if (id) {
      getTrip(id).then((t) => {
        if (!t) return navigate('trip', true)
        setTrip(t)
        setSegs(tripSegments(t))
        setTitles(titlesByDate(t))
      })
      return
    }
    const start = s0 && isDateKey(s0) ? s0 : today
    const end = e0 && isDateKey(e0) && e0 >= start ? e0 : start
    const now = Date.now()
    setTrip({ id: newId(), name: n0 ?? '', start, end, dayTitles: [], coverPhotoId: null, createdAt: now, updatedAt: now })
    setSegs([{ start, end }])
    if (!n0) getEntriesInRange(start, end).then((es) => setTrip((t) => (t && !t.name ? { ...t, name: guessTripName(es) === '旅程' ? '' : guessTripName(es) } : t)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const merging = (others ?? []).filter((t) => mergeIds.includes(t.id))
  const segError = segs.some((x) => !isDateKey(x.start) || !isDateKey(x.end))
    ? '日期沒填完整'
    : segs.some((x) => x.start > x.end)
      ? '每一段的結束日期要在開始日期之後'
      : null
  const effective: Trip | null =
    trip && !segError
      ? merging.length
        ? mergeTrips({ ...trip, segments: segs, titles }, merging)
        : (() => {
            const n = normalizeSegments(segs)
            return n.length ? { ...trip, segments: n, start: n[0].start, end: n[n.length - 1].end } : null
          })()
      : null
  const days = effective ? tripDates(effective) : []
  const error = segError ?? (!effective ? '至少要有一段日期' : days.length > MAX_DAYS ? `一趟旅程最多 ${MAX_DAYS} 天` : null)
  const effKey = effective ? JSON.stringify(tripSegments(effective)) : ''
  const summary = useLiveQuery(async () => (effective && !error ? loadSummary(effective) : null), [effKey, !!error])

  if (!trip) return <div className="page no-tabbar" />
  const set = (patch: Partial<Trip>) => setTrip({ ...trip, ...patch })
  const setSeg = (i: number, patch: Partial<TripSegment>) =>
    setSegs(segs.map((x, j) => (j === i ? { ...x, ...patch, end: patch.start && patch.start > x.end ? patch.start : (patch.end ?? x.end) } : x)))
  const addSeg = () => {
    const last = segs[segs.length - 1]
    const d = last && isDateKey(last.end) ? shiftDate(last.end, 1) : today
    setSegs([...segs, { start: d, end: d }])
  }
  // 併進來的旅程原本的小標題（自己沒填的那天才用）
  const mergedTitles: Record<string, string> = Object.assign({}, ...merging.map(titlesByDate))

  const save = async () => {
    if (!effective || error) return
    setSaving(true)
    try {
      const name = trip.name.trim() || '旅程'
      const finalSegs = tripSegments(effective)
      const keep: Record<string, string> = {}
      for (const d of days) {
        const t = (titles[d] ?? mergedTitles[d] ?? '').trim()
        if (t) keep[d] = t
      }
      await saveTrip({
        ...effective,
        name,
        segments: finalSegs.length > 1 ? finalSegs : undefined,
        start: finalSegs[0].start,
        end: finalSegs[finalSegs.length - 1].end,
        titles: keep,
        dayTitles: [],
        updatedAt: Date.now(),
      })
      for (const t of merging) await deleteTrip(t.id)
      toast(merging.length ? `已併入 ${merging.length} 趟旅程` : id ? '已儲存' : `已建立「${name}」`)
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
  const segCount = effective ? tripSegments(effective).length : 0

  return (
    <div className="page no-tabbar trip-edit">
      <div className="entry-head">
        <button className="btn-text" onClick={() => goBack(id ? `trip/${id}` : 'trip')}>
          取消
        </button>
        <h1>{id ? '編輯旅程' : '建立旅程'}</h1>
        <button className="btn-text strong" onClick={save} disabled={!!error || saving}>
          儲存
        </button>
      </div>

      <div className="stack">
        <section className="card stack">
          <div className="field">
            <label htmlFor="trip-name">名稱</label>
            <input id="trip-name" className="text-input" value={trip.name} placeholder="例如：京都" onChange={(e) => set({ name: e.target.value })} />
          </div>

          <span className="seg-title">日期{segs.length > 1 || merging.length ? '（好幾段）' : ''}</span>
          {segs.map((x, i) => (
            <div key={i} className="trip-seg-block">
              {segs.length > 1 && (
                <div className="trip-seg-head">
                  <span>第 {i + 1} 段</span>
                  <button className="seg-del" aria-label={`刪除第 ${i + 1} 段`} onClick={() => setSegs(segs.filter((_, j) => j !== i))}>
                    <Icon name="close" size={18} />
                  </button>
                </div>
              )}
              <div className="trip-seg">
                <input
                  type="date"
                  className="text-input"
                  aria-label={`第 ${i + 1} 段開始`}
                  value={x.start}
                  onChange={(e) => e.target.value && setSeg(i, { start: e.target.value })}
                />
                <span className="muted">–</span>
                <input
                  type="date"
                  className="text-input"
                  aria-label={`第 ${i + 1} 段結束`}
                  value={x.end}
                  min={x.start}
                  onChange={(e) => e.target.value && setSeg(i, { end: e.target.value })}
                />
              </div>
            </div>
          ))}
          {merging.map((t) => (
            <div key={t.id} className="trip-seg merged">
              <span>
                併入「{t.name}」{formatTripRange(t)} · {tripDaysText(t)}
              </span>
              <button className="seg-del" aria-label={`不要併入${t.name}`} onClick={() => setMergeIds(mergeIds.filter((m) => m !== t.id))}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}

          <div className="seg-actions">
            <button onClick={addSeg}>＋ 加一段日期</button>
            {(others?.length ?? 0) > 0 && (
              <button aria-expanded={picking} onClick={() => setPicking(!picking)}>
                ＋ 併入其他旅程
              </button>
            )}
          </div>

          {picking && others && (
            <div className="merge-pick">
              {others.map((t) => (
                <label key={t.id} className="merge-row">
                  <input
                    type="checkbox"
                    checked={mergeIds.includes(t.id)}
                    onChange={(e) => setMergeIds(e.target.checked ? [...mergeIds, t.id] : mergeIds.filter((m) => m !== t.id))}
                  />
                  <span>
                    <strong>{t.name}</strong>
                    <small>
                      {formatTripRange(t)} · {tripDaysText(t)}
                    </small>
                  </span>
                </label>
              ))}
              <p className="hint" style={{ margin: 0 }}>
                勾選的旅程儲存後會併進這一趟，原本那幾趟就不再單獨列出（紀錄、照片都不會被刪）
              </p>
            </div>
          )}

          {error ? (
            <p className="hint" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          ) : (
            summary && (
              <p className="hint">
                共 {days.length} 天{segCount > 1 ? `（${segCount} 段）` : ''} · {summary.records} 筆紀錄、{summary.photos} 張照片、
                {summary.days.filter((d) => d.route.length > 1).length} 天有軌跡
              </p>
            )
          )}
        </section>

        {!error && days.length > 0 && (
          <section className="card stack">
            <h2 className="section-title" style={{ margin: 0 }}>
              每天的小標題 <span className="muted" style={{ fontWeight: 400 }}>（可不填）</span>
            </h2>
            {days.map((date, i) => (
              <div key={date} className={`trip-day-title${i > 0 && shiftDate(days[i - 1], 1) !== date ? ' gap' : ''}`}>
                <DayDot color={dayColor(i)} dashed={dayDashed(i)} />
                <span className="lbl">
                  Day {i + 1}
                  <small>
                    {Number(date.slice(5, 7))}/{Number(date.slice(8))}
                  </small>
                </span>
                <input
                  className="text-input"
                  aria-label={`Day ${i + 1} 小標題`}
                  value={titles[date] ?? mergedTitles[date] ?? ''}
                  placeholder={i === 0 ? '例如：抵達、東山' : ''}
                  onChange={(e) => setTitles({ ...titles, [date]: e.target.value })}
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
          routes={summary.days.map((d) => ({ points: d.route, color: d.color, dashed: d.dashed }))}
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
              {trip.name} · {tripDaysText(trip)}
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
          {summary.days.map((d, i) => (
            <button
              key={d.date}
              className={i > 0 && shiftDate(summary.days[i - 1].date, 1) !== d.date ? 'gap' : undefined}
              onClick={() => navigate(`day/${d.date}`)} aria-label={`Day ${d.index + 1}${d.title ? ` ${d.title}` : ''}，支出 ${formatNumber(d.expense)}`}>
              <DayDot color={d.color} dashed={d.dashed} />
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

// ── 生成旅遊軌跡圖（圖片／影片） ──

type PosterMode = 'image' | 'video'
const VIDEO_LENGTHS = [10, 15, 20]

function PosterPage({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const trip = await getTrip(id)
    return trip ? { trip, summary: await loadSummary(trip) } : null
  }, [id])
  const [mode, setMode] = useState<PosterMode>('image')
  const [imageRatio, setImageRatio] = useState<PosterRatio>('4:5')
  const [videoRatio, setVideoRatio] = useState<PosterRatio>('9:16')
  const [length, setLength] = useState(15)
  const [basemap, setBasemap] = useState<PosterBasemap>('tea')
  const [showMoney, setShowMoney] = useState(true)
  const [showNames, setShowNames] = useState(true)
  const [showCredit, setShowCredit] = useState(true)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const url = useObjectUrl(blob)
  // 影片
  const [video, setVideo] = useState<VideoResult | null>(null)
  const videoUrl = useObjectUrl(video?.blob)
  const [recording, setRecording] = useState<number | null>(null)
  const liveRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const ratio = mode === 'image' ? imageRatio : videoRatio
  const setRatio = mode === 'image' ? setImageRatio : setVideoRatio

  const input = useMemo((): PosterInput | null => {
    if (!data) return null
    const { trip, summary } = data
    return {
      name: trip.name,
      start: trip.start,
      end: trip.end,
      days: summary.days.map((d) => ({
        color: d.color,
        dashed: d.dashed,
        route: d.route,
        landmark: d.landmark,
        label: `Day ${d.index + 1} · ${d.title || `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}`}`,
        km: d.km,
        photos: d.photos,
        expense: d.expense,
        steps: d.steps ?? 0,
      })),
      stats: { km: summary.km, places: summary.places, photos: summary.photos, expense: summary.expense, steps: summary.steps },
      ratio,
      basemap,
      showMoney,
      showNames,
      showCredit,
    }
  }, [data, ratio, basemap, showMoney, showNames, showCredit])

  const fellBack = (used: PosterBasemap) => {
    if (used === basemap) return
    if (used !== 'none') setBasemap(used)
    toast(used === 'osm' ? '奶茶淡色地圖載入失敗，先改用「淡色地圖」' : '地圖載入失敗，這次先只畫路線（有網路時再試一次）', 4000)
  }

  // 預覽（影片模式錄好之前也先顯示最後的定格畫面）
  useEffect(() => {
    if (!input) return
    let alive = true
    setBusy(true)
    setVideo(null)
    renderPoster(input)
      .then((r) => {
        if (!alive) return
        setBlob(r.blob)
        fellBack(r.used)
      })
      .catch((e) => alive && toast('產生圖片失敗：' + (e as Error).message, 4000))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input])

  useEffect(() => setVideo(null), [length])

  const record = async () => {
    if (!input) return
    const ac = new AbortController()
    abortRef.current = ac
    setVideo(null)
    setRecording(0)
    try {
      const r = await recordVideo(input, length, {
        signal: ac.signal,
        onCanvas: (c) => {
          c.className = 'live-canvas'
          liveRef.current?.replaceChildren(c)
        },
        onProgress: (sec) => setRecording(sec),
      })
      setVideo(r)
      fellBack(r.used)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('錄影失敗：' + (e as Error).message, 5000)
    } finally {
      liveRef.current?.replaceChildren()
      setRecording(null)
      abortRef.current = null
    }
  }

  if (data === null)
    return (
      <div className="page no-tabbar">
        <p className="muted">找不到這趟旅程</p>
      </div>
    )
  const name = data?.trip.name ?? ''
  const canVideo = canRecordVideo()
  const isRecording = recording != null

  return (
    <div className="page no-tabbar poster-page">
      <div className="entry-head">
        <button className="round-btn" aria-label="返回" onClick={() => goBack(`trip/${id}`)}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <div className="segmented small two" role="group" aria-label="輸出成">
          <button aria-pressed={mode === 'image'} disabled={isRecording} onClick={() => setMode('image')}>
            圖片
          </button>
          <button aria-pressed={mode === 'video'} disabled={isRecording} onClick={() => setMode('video')}>
            影片
          </button>
        </div>
        <span style={{ width: 44 }} />
      </div>

      <div className={`poster-preview r${ratio.replace(':', '')}`}>
        {mode === 'video' && videoUrl ? (
          <video src={videoUrl} controls playsInline loop aria-label={`${name}旅遊軌跡影片`} />
        ) : (
          url && !isRecording && <img src={url} alt={`${name}旅遊軌跡圖預覽`} />
        )}
        <div ref={liveRef} className="live" />
        {(busy || (isRecording && recording === 0)) && <span className="spinner" />}
      </div>

      <section className="card stack poster-options">
        <div className="kv">
          <span>比例</span>
          <div className="segmented small two" role="group" aria-label="比例">
            <button aria-pressed={ratio === '4:5'} disabled={isRecording} onClick={() => setRatio('4:5')}>
              4:5 貼文
            </button>
            <button aria-pressed={ratio === '9:16'} disabled={isRecording} onClick={() => setRatio('9:16')}>
              9:16 限動
            </button>
          </div>
        </div>
        {mode === 'video' && (
          <div className="kv">
            <span>長度</span>
            <div className="segmented small three" role="group" aria-label="長度">
              {VIDEO_LENGTHS.map((n) => (
                <button key={n} aria-pressed={length === n} disabled={isRecording} onClick={() => setLength(n)}>
                  {n} 秒
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="kv">
          <span>底圖</span>
          <div className="segmented small two" role="group" aria-label="底圖">
            <button aria-pressed={basemap === 'tea'} disabled={isRecording} onClick={() => setBasemap('tea')}>
              奶茶淡色地圖
            </button>
            <button aria-pressed={basemap === 'osm'} disabled={isRecording} onClick={() => setBasemap('osm')}>
              淡色地圖
            </button>
          </div>
        </div>
        <label className="kv">
          <span>顯示花費</span>
          <input type="checkbox" checked={showMoney} disabled={isRecording} onChange={(e) => setShowMoney(e.target.checked)} />
        </label>
        <label className="kv">
          <span>顯示地名</span>
          <input type="checkbox" checked={showNames} disabled={isRecording} onChange={(e) => setShowNames(e.target.checked)} />
        </label>
        <label className="kv">
          <span>顯示地圖出處</span>
          <input type="checkbox" checked={showCredit} disabled={isRecording} onChange={(e) => setShowCredit(e.target.checked)} />
        </label>
        {!showCredit && (
          <p className="hint" style={{ margin: 0 }}>
            地圖資料來自 OpenStreetMap，授權規定公開分享時要標出處。只自己留存可以關掉；要發到網路上，建議打開。
          </p>
        )}
      </section>

      {mode === 'image' ? (
        <>
          <button className="btn-primary" disabled={!blob || busy} onClick={() => blob && shareOrDownload(blob, `${name}-旅遊軌跡圖.png`)}>
            <Icon name="share" size={20} />
            分享／儲存到照片
          </button>
          <p className="hint" style={{ textAlign: 'center' }}>
            分享選單裡選「儲存影像」就會存進相簿
          </p>
        </>
      ) : !canVideo ? (
        <p className="hint" style={{ textAlign: 'center', color: 'var(--danger)' }}>
          這支手機的瀏覽器不支援錄影，只能輸出圖片
        </p>
      ) : isRecording ? (
        <div className="rec-progress" role="status">
          <div className="meter">
            <span style={{ width: `${(recording / length) * 100}%` }} />
          </div>
          <span>
            錄製中 {recording} / {length} 秒，請停在這個畫面
          </span>
          <button className="btn-text" onClick={() => abortRef.current?.abort()}>
            取消
          </button>
        </div>
      ) : video ? (
        <>
          <button className="btn-primary" onClick={() => shareOrDownload(video.blob, `${name}-旅遊軌跡影片.${video.ext}`)}>
            <Icon name="share" size={20} />
            分享／儲存到照片
          </button>
          <button className="btn-outline" onClick={record}>
            重新錄製
          </button>
          <p className="hint" style={{ textAlign: 'center' }}>
            分享選單裡選「儲存影片」就會存進相簿
          </p>
        </>
      ) : (
        <>
          <button className="btn-primary" disabled={busy} onClick={record}>
            <Icon name="camera" size={20} />
            錄製影片（約 {length} 秒）
          </button>
          <p className="hint" style={{ textAlign: 'center' }}>
            錄的時候要停在這個畫面，螢幕不要關
          </p>
        </>
      )}
    </div>
  )
}
