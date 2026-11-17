import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { MapView, type MapMarker } from '../components/MapView'
import { PhotoImg, PhotoViewer, toast } from '../components/ui'
import { getCategory } from '../lib/categories'
import { formatTwd } from '../lib/currency'
import { buildRoute, buildTimeline, dayStats } from '../lib/day'
import { deleteTrackPoint, getEntriesByDate, getMeta, getSummary, getTrackByDate, saveSummary } from '../lib/db'
import { entryTitle, longAmount } from '../lib/display'
import { goBack, navigate, useLiveQuery } from '../lib/hooks'
import { formatDateLong, formatTime, isDateKey, toDateKey } from '../lib/ledger'
import { MOODS, getMood } from '../lib/moods'
import type { DailySummary, GeoPoint, MoodId } from '../lib/types'

const TAIPEI: GeoPoint = { lat: 25.0418, lng: 121.5435 }

export function DayPage({ date: rawDate }: { date: string }) {
  const date = isDateKey(rawDate) ? rawDate : toDateKey(new Date())
  const entries = useLiveQuery(() => getEntriesByDate(date), [date])
  const track = useLiveQuery(() => getTrackByDate(date), [date])
  const summary = useLiveQuery(() => getSummary(date), [date])
  const lastPos = useLiveQuery(() => getMeta<GeoPoint>('lastPos'), [])
  const [viewer, setViewer] = useState<{ ids: string[]; start: number } | null>(null)

  const route = useMemo(() => buildRoute(entries ?? [], track ?? []), [entries, track])
  const timeline = useMemo(() => buildTimeline(entries ?? [], track ?? []), [entries, track])
  const stats = useMemo(() => dayStats(entries ?? [], track ?? []), [entries, track])
  const markers = useMemo<MapMarker[]>(
    () =>
      route.map((p, i) => ({
        id: p.ref.id,
        lat: p.lat,
        lng: p.lng,
        kind: i === 0 && p.ref.type === 'track' && route.length > 1 ? 'start' : 'checkin',
        label: formatTime(p.time),
      })),
    [route],
  )

  const share = async () => {
    const lines = [`${formatDateLong(date)}`, `支出 ${formatTwd(stats.expense)} · ${stats.km} km · ${stats.places} 個地點`]
    if (summary?.text) lines.push('', summary.text)
    for (const item of timeline) {
      if (item.type === 'entry') {
        const a = longAmount(item.entry)
        lines.push(`${formatTime(item.time)} ${entryTitle(item.entry)}${a ? ' ' + a.main : ''}`)
      }
    }
    const text = lines.join('\n')
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        toast('已複製到剪貼簿')
      }
    } catch {
      /* 使用者取消 */
    }
  }

  return (
    <div className="day-page">
      <div className="day-map">
        <MapView
          route={route}
          markers={markers}
          static
          fallbackCenter={lastPos ?? TAIPEI}
          topPadding={40}
          bottomPadding={24}
          ariaLabel="縮小的當天路線地圖"
        />
        <div className="day-map-buttons">
          <button className="round-btn" aria-label="返回地圖" onClick={() => goBack(`map?d=${date}`)}>
            <Icon name="chevronLeft" size={20} strokeWidth={2.2} />
          </button>
          <button className="round-btn" aria-label="分享這一天" onClick={share}>
            <Icon name="share" size={20} />
          </button>
        </div>
      </div>

      <div className="day-body">
        <div>
          <h1 className="day-title">{formatDateLong(date)}</h1>
          <div className="day-stats">
            <span>
              支出 <strong>{formatTwd(stats.expense)}</strong>
            </span>
            {stats.income > 0 && (
              <span>
                收入 <strong>{formatTwd(stats.income)}</strong>
              </span>
            )}
            <span>
              移動 <strong>{stats.km} km</strong>
            </span>
            <span>
              地點 <strong>{stats.places}</strong>
            </span>
          </div>
        </div>

        {summary !== undefined || entries ? <SummaryCard date={date} summary={summary} /> : null}

        {entries && track && timeline.length === 0 && <p className="muted">這天沒有紀錄。</p>}

        <ol className="tl" aria-label="時間軸">
          {timeline.map((item) => {
            if (item.type === 'track') {
              const p = item.point
              return (
                <li key={p.id} className="tl-track">
                  <span className="dot small" />
                  <span>{formatTime(p.time)}</span>
                  <span>打卡{p.label ? ` ${p.label}` : ''}</span>
                  <button
                    className="btn-text src"
                    style={{ fontSize: 12, minHeight: 32 }}
                    aria-label={`刪除 ${formatTime(p.time)} 的打卡`}
                    onClick={async () => {
                      if (confirm('刪除這個打卡點？')) await deleteTrackPoint(p.id)
                    }}
                  >
                    手動打卡 ×
                  </button>
                </li>
              )
            }
            const e = item.entry
            const cat = getCategory(e.categoryId)
            const amt = longAmount(e)
            return (
              <li key={e.id}>
                <span className="dot" />
                <div className="tl-entry">
                  <button
                    className="tl-entry"
                    onClick={() => navigate(`entry/${e.id}`)}
                    aria-label={`${formatTime(e.time)} ${entryTitle(e)}，編輯`}
                  >
                    <span className="line">
                      <span className="t">{formatTime(e.time)}</span>
                      <span className="name">{entryTitle(e)}</span>
                      {cat && <span className="chip">{cat.name}</span>}
                      {amt && (
                        <span className={`amt${e.kind === 'income' ? ' amount income' : ''}`}>{amt.main}</span>
                      )}
                    </span>
                    {amt?.twd && (
                      <span className="muted" style={{ fontSize: 12, alignSelf: 'flex-end', marginTop: -8 }}>
                        {amt.twd}
                      </span>
                    )}
                    {e.note && <p className="note">{e.note}</p>}
                    {e.location?.name && (
                      <span className="place">
                        <Icon name="pin" size={13} />
                        {e.location.name}
                      </span>
                    )}
                  </button>
                  {e.photoIds.length > 0 && (
                    <div className={`photo-grid${e.photoIds.length === 1 ? ' one' : ''}`}>
                      {e.photoIds.map((pid, i) => (
                        <button
                          key={pid}
                          aria-label={`看大圖：照片 ${i + 1}`}
                          onClick={() => setViewer({ ids: e.photoIds, start: i })}
                        >
                          <PhotoImg id={pid} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        <button className="btn-outline" onClick={() => navigate(`entry/new?d=${date}`)}>
          <Icon name="plus" size={18} />
          在這天新增紀錄
        </button>
      </div>

      {viewer && <PhotoViewer ids={viewer.ids} start={viewer.start} onClose={() => setViewer(null)} />}
    </div>
  )
}

function SummaryCard({ date, summary }: { date: string; summary: DailySummary | undefined }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [mood, setMood] = useState<MoodId | null>(null)

  useEffect(() => {
    if (!editing) {
      setText(summary?.text ?? '')
      setMood(summary?.mood ?? null)
    }
  }, [summary, editing])

  const isToday = date === toDateKey(new Date())

  if (!editing && !summary) {
    return (
      <button className="summary-empty" onClick={() => setEditing(true)}>
        <Icon name="edit" size={18} />
        {isToday ? '寫今天的總結' : '寫這天的總結'}
      </button>
    )
  }

  if (!editing && summary) {
    const m = getMood(summary.mood)
    return (
      <section className="summary-card" aria-label="每日總結">
        <div className="head">
          <strong>
            {isToday ? '今天的總結' : '這天的總結'} · {formatTime(summary.updatedAt)}
          </strong>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {m && (
              <span className="mood">
                <Icon name={m.icon} size={16} />
                {m.label}
              </span>
            )}
            <button className="btn-text" style={{ minHeight: 32, fontSize: 13 }} onClick={() => setEditing(true)}>
              編輯
            </button>
          </span>
        </div>
        {summary.text && <p>{summary.text}</p>}
      </section>
    )
  }

  const save = async () => {
    await saveSummary({ date, text: text.trim(), mood, updatedAt: Date.now() })
    setEditing(false)
  }

  return (
    <section className="summary-card" aria-label="編輯每日總結">
      <div className="head">
        <strong>{isToday ? '今天的總結' : '這天的總結'}</strong>
      </div>
      <div className="mood-picker" role="group" aria-label="心情">
        {MOODS.map((m) => (
          <button key={m.id} aria-pressed={mood === m.id} onClick={() => setMood(mood === m.id ? null : m.id)}>
            <Icon name={m.icon} size={20} />
            {m.label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="summary-text">
        總結內容
      </label>
      <textarea
        id="summary-text"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="今天過得怎麼樣？"
        autoFocus
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn-text" onClick={() => setEditing(false)}>
          取消
        </button>
        <button className="btn-primary" onClick={save}>
          儲存
        </button>
      </div>
    </section>
  )
}
