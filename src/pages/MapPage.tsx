import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Icon } from '../components/Icon'
import { MapView, type MapMarker } from '../components/MapView'
import { MapStyleSheet } from '../components/MapStylePicker'
import { toast } from '../components/ui'
import { getCategory } from '../lib/categories'
import { formatTwd } from '../lib/currency'
import { buildRoute, buildTimeline, dayStats, type RoutePoint } from '../lib/day'
import { getEntriesByDate, getMeta, getPhoto, getTrackByDate, setMeta } from '../lib/db'
import { entrySubtitle, entryTitle, shortAmount } from '../lib/display'
import { getCurrentPosition } from '../lib/geo'
import { navigate, useLiveQuery } from '../lib/hooks'
import { formatDateLong, formatTime, isDateKey, relativeDayLabel, shiftDate, toDateKey } from '../lib/ledger'
import type { Entry, GeoPoint } from '../lib/types'

const TAIPEI: GeoPoint = { lat: 25.0418, lng: 121.5435 }

/** 每筆紀錄第一張照片的縮圖網址，給地圖用 */
function useThumbUrls(entries: Entry[] | undefined): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = entries?.map((e) => `${e.id}:${e.photoIds[0] ?? ''}`).join(',') ?? ''
  useEffect(() => {
    let alive = true
    const made: string[] = []
    ;(async () => {
      const out: Record<string, string> = {}
      for (const e of entries ?? []) {
        if (!e.location || !e.photoIds[0]) continue
        const p = await getPhoto(e.photoIds[0])
        if (!p) continue
        const u = URL.createObjectURL(p.thumb)
        made.push(u)
        out[e.id] = u
      }
      if (alive) setUrls(out)
    })()
    return () => {
      alive = false
      made.forEach((u) => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return urls
}

/** 面板高度：收起時看得到總計和前幾筆，拉開時幾乎全螢幕 */
function useSheetHeights() {
  const calc = () => {
    const h = window.innerHeight
    return { peek: Math.round(Math.max(250, Math.min(330, h * 0.39))), full: Math.round(h - 150) }
  }
  const [sizes, setSizes] = useState(calc)
  useEffect(() => {
    const on = () => setSizes(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return sizes
}

export function MapPage({ date: rawDate }: { date: string | null }) {
  const today = toDateKey(new Date())
  const date = rawDate && isDateKey(rawDate) ? rawDate : today
  const entries = useLiveQuery(() => getEntriesByDate(date), [date])
  const track = useLiveQuery(() => getTrackByDate(date), [date])
  const lastPos = useLiveQuery(() => getMeta<GeoPoint>('lastPos'), [])
  const thumbs = useThumbUrls(entries)
  const [selected, setSelected] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [showStyles, setShowStyles] = useState(false)

  const { peek, full } = useSheetHeights()
  const [sheetH, setSheetH] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const height = sheetH ?? peek
  const expanded = height > (peek + full) / 2

  useEffect(() => setSelected(null), [date])

  const route = useMemo(() => buildRoute(entries ?? [], track ?? []), [entries, track])
  const timeline = useMemo(() => buildTimeline(entries ?? [], track ?? []), [entries, track])
  const stats = useMemo(() => dayStats(entries ?? [], track ?? []), [entries, track])

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = []
    const firstTrack = track?.[0]
    for (const t of track ?? []) {
      const isStart = t === firstTrack && route[0]?.ref.id === t.id && route.length > 1
      out.push({
        id: t.id,
        lat: t.lat,
        lng: t.lng,
        kind: isStart ? 'start' : 'checkin',
        label: `${formatTime(t.time)} 定位${t.label ? ' ' + t.label : ''}`,
      })
    }
    for (const e of entries ?? []) {
      if (!e.location) continue
      out.push({
        id: e.id,
        lat: e.location.lat,
        lng: e.location.lng,
        kind: e.kind === 'diary' ? 'diary' : e.kind === 'income' ? 'income' : 'money',
        thumbUrl: thumbs[e.id],
        label: `${formatTime(e.time)} ${entryTitle(e)}`,
      })
    }
    return out
  }, [entries, track, thumbs, route])

  // ── 播放當天行程 ──
  const [playhead, setPlayhead] = useState<GeoPoint | null>(null)
  const playRaf = useRef<number | null>(null)
  const stopPlay = useCallback(() => {
    if (playRaf.current != null) cancelAnimationFrame(playRaf.current)
    playRaf.current = null
    setPlayhead(null)
  }, [])
  useEffect(() => stopPlay, [stopPlay, date])

  const play = () => {
    if (playRaf.current != null) {
      stopPlay()
      return
    }
    const pts: RoutePoint[] = route
    if (pts.length < 2) return
    const segMs = Math.min(1600, 12000 / (pts.length - 1))
    const startAt = performance.now()
    let lastIdx = -1
    setSheetH(peek)
    const tick = (now: number) => {
      const t = (now - startAt) / segMs
      const i = Math.min(Math.floor(t), pts.length - 1)
      if (i !== lastIdx) {
        lastIdx = i
        setSelected(pts[i].ref.id)
      }
      if (i >= pts.length - 1) {
        setPlayhead({ lat: pts[i].lat, lng: pts[i].lng })
        playRaf.current = null
        setTimeout(() => setPlayhead(null), 800)
        return
      }
      const f = t - i
      const a = pts[i]
      const b = pts[i + 1]
      setPlayhead({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f })
      playRaf.current = requestAnimationFrame(tick)
    }
    playRaf.current = requestAnimationFrame(tick)
  }

  // ── 定位：把地圖移到目前位置（不記錄） ──
  const [myPos, setMyPos] = useState<(GeoPoint & { at: number }) | null>(null)
  const locateMe = async () => {
    setCheckingIn(true)
    try {
      const pos = await getCurrentPosition()
      await setMeta('lastPos', { lat: pos.lat, lng: pos.lng })
      setSelected(null)
      setMyPos({ lat: pos.lat, lng: pos.lng, at: Date.now() })
    } catch (e) {
      toast((e as Error).message, 4000)
    } finally {
      setCheckingIn(false)
    }
  }

  // ── 拖動面板 ──
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null)
  const onDown = (e: RPointerEvent) => {
    drag.current = { y: e.clientY, h: height, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dy = d.y - e.clientY
    if (Math.abs(dy) > 4) {
      d.moved = true
      setDragging(true)
    }
    if (d.moved) setSheetH(Math.max(140, Math.min(full, d.h + dy)))
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d) return
    if (!d.moved) {
      setSheetH(expanded ? peek : full)
      return
    }
    setSheetH(height > (peek + full) / 2 ? full : peek)
  }

  const label = relativeDayLabel(date, today)
  const isToday = date === today
  const listRef = useRef<HTMLDivElement>(null)

  // 點地圖標記 → 時間軸捲到那一筆
  useEffect(() => {
    if (!selected) return
    listRef.current?.querySelector(`[data-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  const loaded = entries && track

  return (
    <div className="map-page" style={{ "--sheet-h": `${height}px` } as React.CSSProperties}>
      <MapView
        route={route}
        markers={markers}
        selectedId={selected}
        onSelect={(id) => setSelected(id)}
        playhead={playhead}
        myLocation={myPos}
        fallbackCenter={lastPos ?? TAIPEI}
        bottomPadding={peek + 56}
        topPadding={70}
        ariaLabel={`${formatDateLong(date)}的路線地圖`}
      />

      <div className="topbar">
        <div className="date-pill">
          <button className="nav" aria-label="前一天" onClick={() => navigate(`map?d=${shiftDate(date, -1)}`, true)}>
            <Icon name="chevronLeft" size={20} strokeWidth={2.2} />
          </button>
          <button className="label" onClick={() => navigate(`day/${date}`)} aria-label={`${formatDateLong(date)}，查看完整回顧`}>
            <strong>{formatDateLong(date)}</strong>
            <span>{label}</span>
          </button>
          <button
            className="nav"
            aria-label="後一天"
            disabled={isToday}
            onClick={() => navigate(`map?d=${shiftDate(date, 1)}`, true)}
          >
            <Icon name="chevronRight" size={20} strokeWidth={2.2} />
          </button>
        </div>
        <label className="round-btn lg date-input-wrap" aria-label="選擇日期">
          <Icon name="calendar" />
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && navigate(`map?d=${e.target.value}`, true)}
          />
        </label>
      </div>

      <div className="map-actions" style={{ bottom: `calc(var(--tabbar-h) + ${height + 16}px)` }} hidden={expanded}>
        <button className="checkin-btn" onClick={() => setShowStyles(true)} aria-label="地圖樣式">
          <Icon name="layers" size={18} />
          樣式
        </button>
        {route.length > 1 && (
          <button className="checkin-btn" onClick={play} aria-label={playhead ? '停止播放' : '播放當天行程'}>
            <Icon name={playhead ? 'pause' : 'play'} size={18} />
          </button>
        )}
        <button className="checkin-btn" onClick={locateMe} disabled={checkingIn} aria-label="定位：地圖移到目前位置">
          {checkingIn ? <span className="spinner" /> : <Icon name="locate" size={18} />}
          定位
        </button>
        <button className="fab" aria-label="新增紀錄" onClick={() => navigate(`entry/new?d=${date}`)}>
          <Icon name="plus" size={28} strokeWidth={2.4} />
        </button>
      </div>

      <section className={`sheet${dragging ? ' dragging' : ''}`} style={{ height }} aria-label="當天紀錄">
        <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <button className="sheet-handle" aria-label={expanded ? '收起面板' : '展開面板'} aria-expanded={expanded} />
          <div className="sheet-head">
            <div>
              <div className="total-label">{isToday ? '今日支出' : '當日支出'}</div>
              <div className="total">{formatTwd(stats.expense)}</div>
            </div>
            <div className="meta">
              <span>
                {stats.places} 個地點 · {stats.km} km
              </span>
              <span>
                {stats.records} 則紀錄 · {stats.photos} 張照片
              </span>
            </div>
          </div>
        </div>
        <div className="sheet-body" ref={listRef}>
          {loaded && timeline.length === 0 && (
            <div className="sheet-empty">
              {isToday ? '今天還沒有紀錄，按右邊的 + 記一筆' : '這天沒有紀錄'}
            </div>
          )}
          {timeline.map((item) =>
            item.type === 'track' ? (
              <button
                key={item.point.id}
                data-id={item.point.id}
                className={`row track-row${selected === item.point.id ? ' selected' : ''}`}
                onClick={() => setSelected(item.point.id)}
              >
                <span className="time">{formatTime(item.time)}</span>
                <span className="badge track">
                  <Icon name="locate" size={16} />
                </span>
                <span className="main">
                  <span className="title">定位{item.point.label ? ` · ${item.point.label}` : ''}</span>
                </span>
              </button>
            ) : (
              <EntryRow
                key={item.entry.id}
                entry={item.entry}
                thumb={thumbs[item.entry.id]}
                selected={selected === item.entry.id}
                onSelect={() => (item.entry.location ? setSelected(item.entry.id) : navigate(`entry/${item.entry.id}`))}
              />
            ),
          )}
          {loaded && timeline.length > 0 && (
            <div className="sheet-foot">
              <button className="btn-outline" onClick={() => navigate(`day/${date}`)}>
                查看完整回顧
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
          )}
        </div>
      </section>
      {showStyles && <MapStyleSheet onClose={() => setShowStyles(false)} />}
    </div>
  )
}

function EntryRow({
  entry,
  thumb,
  selected,
  onSelect,
}: {
  entry: Entry
  thumb?: string
  selected: boolean
  onSelect: () => void
}) {
  const cat = getCategory(entry.categoryId)
  const amt = shortAmount(entry)
  return (
    <div className={`row${selected ? ' selected' : ''}`} data-id={entry.id}>
      <button className="row" style={{ padding: 0, flex: 1, minWidth: 0 }} onClick={onSelect}>
        <span className="time">{formatTime(entry.time)}</span>
        {thumb ? (
          <span className="badge photo">
            <img src={thumb} alt="" />
          </span>
        ) : (
          <span className="badge">
            <Icon name={cat?.icon ?? 'edit'} size={20} />
          </span>
        )}
        <span className="main">
          <span className="title">{entryTitle(entry)}</span>
          <span className="sub">{entrySubtitle(entry)}</span>
        </span>
        {amt && (
          <span className={`amount${entry.kind === 'income' ? ' income' : ''}`}>
            {amt.main}
            {amt.twd && <small>{amt.twd}</small>}
          </span>
        )}
      </button>
      {selected && (
        <button className="row-edit" onClick={() => navigate(`entry/${entry.id}`)}>
          編輯
        </button>
      )}
    </div>
  )
}
