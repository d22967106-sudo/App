import { describe, expect, it } from 'vitest'
import { calendarDays, categoryTotals, comparePeriod, eachDate, expenseSeries, firstWeekday, shiftMonth, sumExpenseUntil } from './stats'
import { formatTripRange, guessHome, guessTripName, suggestTrips, summarizeTrip } from './trips'
import { formatBytes, yearsLeft, yearsText } from './usage'
import type { Entry, TrackPoint, Trip } from './types'

let seq = 0
function entry(p: Partial<Entry> = {}): Entry {
  seq++
  const date = p.date ?? '2026-11-17'
  const [y, m, d] = date.split('-').map(Number)
  return {
    id: `e${seq}`,
    kind: 'expense',
    title: '',
    amount: 100,
    currency: 'TWD',
    rate: 1,
    amountTwd: 100,
    categoryId: 'food',
    note: '',
    time: new Date(y, m - 1, d, 12, seq % 60).getTime(),
    date,
    location: null,
    photoIds: [],
    placeId: null,
    createdAt: seq,
    updatedAt: seq,
    ...p,
  }
}

const chiayi = { lat: 23.48, lng: 120.45 }
const tainan = { lat: 22.99, lng: 120.2 } // 嘉義往南約 60 km

function pt(date: string, hour: number, at: { lat: number; lng: number }): TrackPoint {
  const [y, m, d] = date.split('-').map(Number)
  return { id: `t${date}-${hour}`, time: new Date(y, m - 1, d, hour).getTime(), date, lat: at.lat, lng: at.lng, accuracy: 10, source: 'auto' }
}

describe('統計', () => {
  it('月份工具', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(firstWeekday('2026-11')).toBe(0) // 2026/11/1 是星期日
    expect(eachDate('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
  })

  it('日曆：每天支出、第一張照片、日記', () => {
    const days = calendarDays(
      '2026-11',
      [
        entry({ date: '2026-11-02', amountTwd: 300, photoIds: ['p1'] }),
        entry({ date: '2026-11-02', kind: 'income', amountTwd: 50 }),
        entry({ date: '2026-11-04', kind: 'diary', amount: null, amountTwd: null, note: '散步' }),
        entry({ date: '2026-10-31', amountTwd: 999 }),
      ],
      [{ date: '2026-11-05', text: '今天好累', mood: null, updatedAt: 1 }],
    )
    expect(days.get('2026-11-02')).toMatchObject({ expense: 300, income: 50, photoId: 'p1', hasDiary: false, records: 2 })
    expect(days.get('2026-11-04')).toMatchObject({ expense: 0, hasDiary: true })
    expect(days.get('2026-11-05')).toMatchObject({ records: 0, hasDiary: true })
    expect(days.has('2026-10-31')).toBe(false)
    expect(days.has('2026-11-03')).toBe(false)
  })

  it('分類加總與每日長條', () => {
    const list = [
      entry({ date: '2026-11-01', amountTwd: 100, categoryId: 'food' }),
      entry({ date: '2026-11-01', amountTwd: 250, categoryId: 'transport' }),
      entry({ date: '2026-11-03', amountTwd: 50, categoryId: 'food' }),
      entry({ date: '2026-11-03', amountTwd: 70, categoryId: null }),
      entry({ date: '2026-11-03', kind: 'income', amountTwd: 1000, categoryId: 'salary' }),
    ]
    expect(categoryTotals(list).map((c) => [c.name, c.amount])).toEqual([
      ['交通', 250],
      ['餐飲', 150],
      ['其他', 70],
    ])
    expect(expenseSeries(list, ['2026-11-01', '2026-11-02', '2026-11-03'], (e) => e.date)).toEqual([350, 0, 120])
  })

  it('跟上個月比：本月比同期，過去的月份比整個月', () => {
    expect(comparePeriod('2026-11', '2026-11-19')).toEqual({ prevMonth: '2026-10', untilDay: 19 })
    expect(comparePeriod('2026-03', '2026-03-31')).toEqual({ prevMonth: '2026-02', untilDay: 28 })
    expect(comparePeriod('2026-10', '2026-11-19')).toEqual({ prevMonth: '2026-09', untilDay: null })
    const prev = [entry({ date: '2026-10-05', amountTwd: 100 }), entry({ date: '2026-10-25', amountTwd: 900 })]
    expect(sumExpenseUntil(prev, 19)).toBe(100)
    expect(sumExpenseUntil(prev, null)).toBe(1000)
  })
})

describe('旅程', () => {
  const home: TrackPoint[] = []
  for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']) home.push(pt(d, 8, chiayi), pt(d, 22, chiayi))

  it('最常過夜的地方＝家', () => {
    const h = guessHome([], home)!
    expect(h.lat).toBeCloseTo(chiayi.lat, 3)
    expect(guessHome([], home.slice(0, 2))).toBeNull()
  })

  it('離家超過 50 公里連續兩天以上才建議，已建立或按過「不用」的不再建議', () => {
    const away = [pt('2026-11-12', 10, tainan), pt('2026-11-13', 10, tainan), pt('2026-11-14', 10, tainan), pt('2026-11-16', 10, tainan)]
    const entries = [entry({ date: '2026-11-13', location: { ...tainan, name: '中西區 · 臺南市' } })]
    const track = [...home, ...away]
    const s = suggestTrips(entries, track, [], [], '2026-11-19')
    expect(s).toEqual([{ start: '2026-11-12', end: '2026-11-14', name: '臺南' }])
    expect(suggestTrips(entries, track, [{ start: '2026-11-13', end: '2026-11-13' }], [], '2026-11-19')).toEqual([])
    expect(suggestTrips(entries, track, [], ['2026-11-12_2026-11-14'], '2026-11-19')).toEqual([])
    // 還沒回來的不建議
    expect(suggestTrips(entries, track, [], [], '2026-11-14')).toEqual([])
  })

  it('旅程名稱取最常出現的縣市', () => {
    expect(
      guessTripName([
        entry({ location: { ...tainan, name: '安平 · 臺南市' } }),
        entry({ location: { ...tainan, name: '中西區 · 臺南市' } }),
        entry({ location: { ...chiayi, name: '東區 · 嘉義市' } }),
      ]),
    ).toBe('臺南')
    expect(guessTripName([])).toBe('旅程')
  })

  it('旅程統計：每天一種顏色、外幣、代表地點', () => {
    const trip: Trip = { id: 't', name: '京都', start: '2026-10-03', end: '2026-10-04', dayTitles: ['抵達'], coverPhotoId: null, createdAt: 1, updatedAt: 1 }
    const kyoto = { lat: 35.0, lng: 135.76 }
    const arashiyama = { lat: 35.01, lng: 135.67 }
    const entries = [
      entry({ date: '2026-10-03', currency: 'JPY', amount: 1000, rate: 0.21, amountTwd: 210, location: { ...kyoto, name: '祇園 · 京都' }, photoIds: ['a'] }),
      entry({ date: '2026-10-04', currency: 'JPY', amount: 500, rate: 0.21, amountTwd: 105, location: { ...kyoto, name: '祇園 · 京都' } }),
      entry({ date: '2026-10-04', currency: 'JPY', amount: 300, rate: 0.21, amountTwd: 63, location: { ...arashiyama, name: '嵐山 · 京都' } }),
    ]
    const s = summarizeTrip(trip, entries, [], [{ date: '2026-10-03', steps: 12000, updatedAt: 1 }])
    expect(s.days.map((d) => [d.color, d.title, d.expense])).toEqual([
      ['#4F7CAC', '抵達', 210],
      ['#C9733C', '', 168],
    ])
    expect(s.expense).toBe(378)
    expect(s.foreign).toEqual([['JPY', 1800]])
    expect(s.steps).toBe(12000)
    expect(s.photoIds).toEqual(['a'])
    expect(s.days[1].landmark?.name).toBe('嵐山')
    expect(s.km).toBeGreaterThan(5)
  })

  it('日期範圍的寫法', () => {
    expect(formatTripRange({ start: '2026-11-12', end: '2026-11-14' })).toBe('2026/11/12 – 11/14')
    expect(formatTripRange({ start: '2026-12-30', end: '2027-01-02' })).toBe('2026/12/30 – 2027/1/2')
  })
})

describe('使用狀況', () => {
  it('估算還能用幾年', () => {
    const MB = 1024 * 1024
    // 30 天長了 1 MB，已用 20 MB → (480 MB / (1/30 MB/天)) / 365 ≈ 39.5 年
    expect(yearsLeft(20 * MB, 500 * MB, MB, 30)).toBeCloseTo(39.5, 0)
    expect(yearsLeft(20 * MB, 500 * MB, MB, 5)).toBeNull()
    expect(yearsLeft(20 * MB, 500 * MB, 1, 30)).toBe(99)
    expect(yearsText(null)).toContain('資料還太少')
    expect(yearsText(0.5)).toBe('照現在的速度，大約 6 個月後會滿')
    expect(formatBytes(1536)).toBe('2 KB')
    expect(formatBytes(12.3 * MB)).toBe('12.3 MB')
  })
})
