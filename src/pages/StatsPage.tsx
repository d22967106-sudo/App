import { useState } from 'react'
import { Icon } from '../components/Icon'
import { formatNumber, formatTwd } from '../lib/currency'
import { getEntriesInRange, getStepsInRange, getTrackInRange } from '../lib/db'
import { entryTitle } from '../lib/display'
import { navigate, useLiveQuery } from '../lib/hooks'
import { toDateKey, totalTwd } from '../lib/ledger'
import {
  categoryTotals,
  comparePeriod,
  daysInMonth,
  eachDate,
  expenseSeries,
  lifeStats,
  monthRange,
  shiftMonth,
  sumExpenseUntil,
} from '../lib/stats'
import type { Entry } from '../lib/types'

/** p＝YYYY-MM（月）或 YYYY（年） */
export function StatsPage({ period }: { period: string | null }) {
  const today = toDateKey(new Date())
  const isYear = !!period && /^\d{4}$/.test(period)
  const month = !isYear && period && /^\d{4}-\d{2}$/.test(period) ? period : today.slice(0, 7)
  const year = isYear ? period! : month.slice(0, 4)
  const go = (p: string) => navigate(`stats?p=${p}`, true)

  const canNext = isYear ? year < today.slice(0, 4) : month < today.slice(0, 7)
  const label = isYear ? `${year} 年` : `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`

  return (
    <div className="page stats-page">
      <div className="page-head">
        <h1 className="big-title">統計</h1>
        <button className="round-btn" aria-label="設定（雲端同步、自動化、地圖樣式、備份）" onClick={() => navigate('settings')}>
          <Icon name="gear" size={22} />
        </button>
      </div>

      <div className="stats-period">
        <div className="segmented small" role="group" aria-label="期間">
          <button aria-pressed={!isYear} onClick={() => go(year === today.slice(0, 4) ? today.slice(0, 7) : `${year}-12`)}>
            月
          </button>
          <button aria-pressed={isYear} onClick={() => go(year)}>
            年
          </button>
        </div>
        <div className="stats-nav">
          <button aria-label={isYear ? '前一年' : '上個月'} onClick={() => go(isYear ? String(Number(year) - 1) : shiftMonth(month, -1))}>
            <Icon name="chevronLeft" size={20} />
          </button>
          <strong>{label}</strong>
          <button
            aria-label={isYear ? '後一年' : '下個月'}
            disabled={!canNext}
            onClick={() => go(isYear ? String(Number(year) + 1) : shiftMonth(month, 1))}
          >
            <Icon name="chevronRight" size={20} />
          </button>
        </div>
      </div>

      {isYear ? <YearStats year={year} today={today} /> : <MonthStats month={month} today={today} />}
    </div>
  )
}

function MonthStats({ month, today }: { month: string; today: string }) {
  const { start, end } = monthRange(month)
  const { prevMonth, untilDay } = comparePeriod(month, today)
  const data = useLiveQuery(async () => {
    const prev = monthRange(prevMonth)
    const [entries, prevEntries, track, steps] = await Promise.all([
      getEntriesInRange(start, end),
      getEntriesInRange(prev.start, prev.end),
      getTrackInRange(start, end),
      getStepsInRange(start, end),
    ])
    return { entries, prevTotal: sumExpenseUntil(prevEntries, untilDay), life: lifeStats(entries, track, steps) }
  }, [start, end, prevMonth, untilDay])
  if (!data) return null
  const dates = eachDate(start, end)
  const series = expenseSeries(data.entries, dates, (e) => e.date)
  const passed = today.startsWith(month) ? Number(today.slice(8)) : today > end ? daysInMonth(month) : 0
  const compareText = untilDay != null ? '比上個月同期' : '比上個月'
  return (
    <StatsBody
      entries={data.entries}
      prevTotal={data.prevTotal}
      compareText={compareText}
      life={data.life}
      chartTitle="每日支出"
      chartHint="點長條看那一天"
      series={series}
      avgDays={passed}
      avgLabel="日均"
      ticks={(i) => (i === 0 || (i + 1) % 10 === 0 ? String(i + 1) : '')}
      barLabel={(i) => `${Number(month.slice(5))}月${i + 1}日`}
      onBar={(i) => navigate(`map?d=${dates[i]}`)}
    />
  )
}

function YearStats({ year, today }: { year: string; today: string }) {
  const start = `${year}-01-01`
  const end = `${year}-12-31`
  const thisYear = today.startsWith(year)
  const data = useLiveQuery(async () => {
    const prevYear = String(Number(year) - 1)
    const [entries, prevEntries, track, steps] = await Promise.all([
      getEntriesInRange(start, end),
      getEntriesInRange(`${prevYear}-01-01`, thisYear ? `${prevYear}${today.slice(4)}` : `${prevYear}-12-31`),
      getTrackInRange(start, end),
      getStepsInRange(start, end),
    ])
    return { entries, prevTotal: totalTwd(prevEntries, 'expense'), life: lifeStats(entries, track, steps) }
  }, [year, thisYear, today])
  if (!data) return null
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  const series = expenseSeries(data.entries, months, (e) => e.date.slice(0, 7))
  const passedMonths = thisYear ? Number(today.slice(5, 7)) : today > end ? 12 : 0
  return (
    <StatsBody
      entries={data.entries}
      prevTotal={data.prevTotal}
      compareText={thisYear ? '比去年同期' : '比去年'}
      life={data.life}
      chartTitle="每月支出"
      chartHint="點長條看那個月"
      series={series}
      avgDays={passedMonths}
      avgLabel="月均"
      ticks={(i) => String(i + 1)}
      barLabel={(i) => `${i + 1}月`}
      onBar={(i) => navigate(`stats?p=${months[i]}`, true)}
    />
  )
}

interface BodyProps {
  entries: Entry[]
  prevTotal: number
  compareText: string
  life: ReturnType<typeof lifeStats>
  chartTitle: string
  chartHint: string
  series: number[]
  /** 已經過了幾天（或幾個月），算平均用 */
  avgDays: number
  avgLabel: string
  ticks: (i: number) => string
  barLabel: (i: number) => string
  onBar: (i: number) => void
}

function StatsBody(p: BodyProps) {
  const expense = totalTwd(p.entries, 'expense')
  const income = totalTwd(p.entries, 'income')
  const diff = expense - p.prevTotal
  const cats = categoryTotals(p.entries)
  const foreign = p.entries.some((e) => e.kind !== 'diary' && e.currency !== 'TWD')
  const total = p.series.reduce((a, b) => a + b, 0)
  const avg = p.avgDays > 0 ? total / p.avgDays : 0
  const max = Math.max(...p.series, avg, 1)
  const [openCat, setOpenCat] = useState<string | null>(null)

  return (
    <div className="stack">
      <section className="card stats-card" aria-label="收支">
        <span className="lbl">支出</span>
        <span className="stats-total">{formatTwd(expense)}</span>
        {p.prevTotal > 0 ? (
          <span className="stats-compare">
            {p.compareText}{' '}
            <b>
              {diff === 0 ? '一樣' : `${diff > 0 ? '多' : '少'} ${formatTwd(Math.abs(diff))}`}
            </b>
          </span>
        ) : null}
        <div className="divider" />
        <div className="stats-pair">
          <div>
            <span className="lbl">收入</span>
            <strong>{formatTwd(income)}</strong>
          </div>
          <div>
            <span className="lbl">結餘</span>
            <strong>{formatTwd(income - expense)}</strong>
          </div>
        </div>
        {foreign && <span className="lbl">外幣依每筆當時的匯率換算成台幣</span>}
      </section>

      <section className="card stats-card" aria-label={p.chartTitle}>
        <div className="stats-card-head">
          <h2>{p.chartTitle}</h2>
          <span className="lbl">{p.chartHint}</span>
        </div>
        <div className="bars">
          {avg > 0 && (
            <div className="bars-avg" style={{ bottom: `${(avg / max) * 100}%` }}>
              <span>
                {p.avgLabel} {formatNumber(Math.round(avg))}
              </span>
            </div>
          )}
          {p.series.map((v, i) => (
            <button key={i} aria-label={`${p.barLabel(i)} 支出 ${formatNumber(v)}`} onClick={() => p.onBar(i)}>
              <span style={{ height: v > 0 ? `max(2px, ${(v / max) * 100}%)` : 0 }} />
            </button>
          ))}
        </div>
        <div className="bars-ticks" aria-hidden="true">
          {p.series.map((_, i) => (
            <span key={i}>{p.ticks(i)}</span>
          ))}
        </div>
      </section>

      <section className="card stats-card" aria-label="分類">
        <div className="stats-card-head">
          <h2>分類</h2>
          {cats.length > 0 && <span className="lbl">點分類看明細</span>}
        </div>
        {cats.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 14 }}>這段期間沒有支出</p>}
        {cats.map((c) => (
          <div key={c.id}>
            <button className="cat-row" aria-expanded={openCat === c.id} onClick={() => setOpenCat(openCat === c.id ? null : c.id)}>
              <span className="name">{c.name}</span>
              <span className="track">
                <span style={{ width: `${(c.amount / cats[0].amount) * 100}%` }} />
              </span>
              <span className="amt">{formatNumber(c.amount)}</span>
              <span className="pct">{Math.round((c.amount / expense) * 100)}%</span>
            </button>
            {openCat === c.id && <CategoryDetail entries={p.entries.filter((e) => e.kind === 'expense' && (e.categoryId ?? 'other') === c.id)} />}
          </div>
        ))}
      </section>

      <section className="stats-tiles" aria-label="生活">
        <div>
          <span className="lbl">平均每天步數</span>
          <strong>{p.life.avgSteps != null ? formatNumber(p.life.avgSteps) : '—'}</strong>
        </div>
        <div>
          <span className="lbl">移動距離</span>
          <strong>{formatNumber(p.life.km < 10 ? p.life.km : Math.round(p.life.km))} km</strong>
        </div>
        <div>
          <span className="lbl">去過的地點</span>
          <strong>{p.life.places} 個</strong>
        </div>
        <div>
          <span className="lbl">照片</span>
          <strong>{p.life.photos} 張</strong>
        </div>
      </section>
    </div>
  )
}

function CategoryDetail({ entries }: { entries: Entry[] }) {
  const list = [...entries].sort((a, b) => (b.amountTwd ?? 0) - (a.amountTwd ?? 0))
  return (
    <ul className="cat-detail">
      {list.slice(0, 30).map((e) => (
        <li key={e.id}>
          <button onClick={() => navigate(`entry/${e.id}`)}>
            <span className="d">{Number(e.date.slice(5, 7))}/{Number(e.date.slice(8))}</span>
            <span className="t">{entryTitle(e)}</span>
            <span className="a">{formatNumber(e.amountTwd ?? 0)}</span>
          </button>
        </li>
      ))}
      {list.length > 30 && <li className="muted more">還有 {list.length - 30} 筆</li>}
    </ul>
  )
}
