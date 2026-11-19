import { Icon } from '../components/Icon'
import { PhotoImg } from '../components/ui'
import { formatNumber, formatTwd } from '../lib/currency'
import { dayStats } from '../lib/day'
import { getAllTrips, getEntriesByDate, getEntriesInRange, getSteps, getSummariesInRange, getSummary, getTrackByDate } from '../lib/db'
import { navigate, useLiveQuery } from '../lib/hooks'
import { formatDateLong, isDateKey, relativeDayLabel, toDateKey, totalTwd } from '../lib/ledger'
import { calendarDays, daysInMonth, firstWeekday, monthRange, shiftMonth } from '../lib/stats'
import type { Trip } from '../lib/types'

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

/** 日曆：每天的支出、照片、日記；旅程用橫條標出來；點一天看摘要 */
export function CalendarPage({ month: monthParam, selected: selParam }: { month: string | null; selected: string | null }) {
  const today = toDateKey(new Date())
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : today.slice(0, 7)
  const selected = selParam && isDateKey(selParam) && selParam.startsWith(month) ? selParam : today.startsWith(month) ? today : null
  const { start, end } = monthRange(month)

  const data = useLiveQuery(async () => {
    const [entries, summaries, trips] = await Promise.all([getEntriesInRange(start, end), getSummariesInRange(start, end), getAllTrips()])
    return { entries, summaries, trips: trips.filter((t) => t.start <= end && t.end >= start) }
  }, [start, end])

  const days = data ? calendarDays(month, data.entries, data.summaries) : new Map()
  const monthEntries = data?.entries ?? []
  const lead = firstWeekday(month)
  const total = daysInMonth(month)
  const cells: (string | null)[] = [...Array(lead).fill(null)]
  for (let d = 1; d <= total; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)

  const go = (m: string, d?: string | null) => navigate(`calendar?m=${m}${d ? `&d=${d}` : ''}`, true)
  const [y, mo] = month.split('-').map(Number)

  return (
    <div className="page cal-page">
      <div className="cal-head">
        <div className="date-pill">
          <button className="nav" aria-label="上個月" onClick={() => go(shiftMonth(month, -1))}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <div className="label">
            <strong>
              {y} 年 {mo} 月
            </strong>
          </div>
          <button className="nav" aria-label="下個月" onClick={() => go(shiftMonth(month, 1))}>
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
        <button className="cal-today" onClick={() => go(today.slice(0, 7), today)}>
          今天
        </button>
      </div>

      <div className="cal-summary">
        <span>
          支出 <b>{formatTwd(totalTwd(monthEntries, 'expense'))}</b>
        </span>
        <span>
          收入 <b>{formatTwd(totalTwd(monthEntries, 'income'))}</b>
        </span>
        <span>
          記錄 <b>{days.size}</b> 天
        </span>
      </div>

      <div className="cal-grid cal-week" aria-hidden="true">
        {WEEK.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="cal-grid" role="grid" aria-label={`${y} 年 ${mo} 月`}>
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} />
          const d = days.get(date)
          const future = date > today
          const trip = data?.trips.find((t) => date >= t.start && date <= t.end)
          const col = i % 7
          const bandStart = trip && (date === trip.start || col === 0)
          const bandEnd = trip && (date === trip.end || col === 6 || date === end)
          const label = [
            formatDateLong(date),
            trip ? `${trip.name}旅程` : '',
            d?.expense ? `支出 ${formatNumber(d.expense)}` : '',
            d?.photoId ? '有照片' : '',
            d?.hasDiary ? '有日記' : '',
          ]
            .filter(Boolean)
            .join('，')
          return (
            <button
              key={date}
              className={`cal-cell${date === selected ? ' selected' : ''}${date === today ? ' today' : ''}`}
              disabled={future}
              aria-label={label}
              aria-pressed={date === selected}
              onClick={() => go(month, date)}
            >
              <span className="num">{Number(date.slice(8))}</span>
              {d && d.expense > 0 && <span className="amt">{formatNumber(d.expense)}</span>}
              {d?.photoId ? (
                <span className="thumb">
                  <PhotoImg id={d.photoId} />
                </span>
              ) : d?.hasDiary ? (
                <span className="dot" />
              ) : null}
              {trip && (
                <span className={`band${bandStart ? ' start' : ''}${bandEnd ? ' end' : ''}`}>
                  {bandStart && <TripBandLabel trip={trip} date={date} col={col} />}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selected ? <DayCard date={selected} /> : <p className="muted cal-hint">點一天看那天的摘要</p>}
    </div>
  )
}

function TripBandLabel({ trip, date, col }: { trip: Trip; date: string; col: number }) {
  // 只在旅程開始那格（或換週的第一格）顯示名稱
  const days = Math.round((Date.parse(trip.end) - Date.parse(trip.start)) / 86400000) + 1
  const text = date === trip.start ? `${trip.name} ${days} 天` : trip.name
  return <span className="band-label" style={{ maxWidth: `${(7 - col) * 100}%` }}>{text}</span>
}

function DayCard({ date }: { date: string }) {
  const info = useLiveQuery(async () => {
    const [entries, track, steps, summary] = await Promise.all([getEntriesByDate(date), getTrackByDate(date), getSteps(date), getSummary(date)])
    const stats = dayStats(entries, track)
    const photos = entries.flatMap((e) => e.photoIds)
    const note = summary?.text.trim() || entries.find((e) => e.note.trim())?.note.trim() || ''
    return { stats, steps: steps?.steps ?? null, photos, note, empty: !entries.length && !track.length && !note }
  }, [date])
  const rel = relativeDayLabel(date)
  return (
    <section className="card cal-day" aria-label={formatDateLong(date)}>
      <div className="cal-day-head">
        <span className="title">
          {formatDateLong(date)}
          {rel && <small> · {rel}</small>}
        </span>
        <a
          href={`#/map?d=${date}`}
          onClick={(e) => {
            e.preventDefault()
            navigate(`map?d=${date}`)
          }}
        >
          打開這一天 ›
        </a>
      </div>
      {info && (
        <>
          <div className="cal-day-stats">
            <div>
              <span>支出</span>
              <strong>{formatTwd(info.stats.expense)}</strong>
            </div>
            <div>
              <span>步數</span>
              <strong>{info.steps != null ? formatNumber(info.steps) : '—'}</strong>
            </div>
            <div>
              <span>地點</span>
              <strong>{info.stats.places} 個</strong>
            </div>
          </div>
          {(info.photos.length > 0 || info.note) && (
            <div className="cal-day-more">
              {info.photos.slice(0, 2).map((id) => (
                <span key={id} className="ph">
                  <PhotoImg id={id} />
                </span>
              ))}
              {info.note && <p>{info.note}</p>}
            </div>
          )}
          {info.empty && <p className="muted" style={{ margin: 0, fontSize: 14 }}>這天沒有紀錄</p>}
        </>
      )}
    </section>
  )
}
