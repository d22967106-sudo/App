import { describe, expect, it } from 'vitest'
import { calendarDays, categoryTotals, comparePeriod, eachDate, expenseSeries, firstWeekday, shiftMonth, sumExpenseUntil } from './stats'
import { dayColor, dayDashed, dayTitle, formatTripRange, mergeTrips, normalizeSegments, tripDates, tripDaysText, guessHome, guessTripName, suggestTrips, summarizeTrip } from './trips'
import { formatBytes, yearsLeft, yearsText } from './usage'
import { AUTO_MAX_SEC, pickEvenly, planVideo, videoFrameAt } from './posterTimeline'
import type { PosterInput } from './poster'
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
      ['#59413C', '抵達', 210],
      ['#8D4E29', '', 168],
    ])
    expect(s.expense).toBe(378)
    expect(s.foreign).toEqual([['JPY', 1800]])
    expect(s.steps).toBe(12000)
    expect(s.photoIds).toEqual(['a'])
    expect(s.days[1].landmark?.name).toBe('嵐山')
    expect(s.km).toBeGreaterThan(5)
  })

  it('每天的顏色：10 色，第 11–20 天虛線', () => {
    expect([dayColor(0), dayDashed(0)]).toEqual(['#59413C', false])
    expect([dayColor(10), dayDashed(10)]).toEqual(['#59413C', true])
    expect([dayColor(19), dayDashed(19)]).toEqual(['#B37148', true])
    expect([dayColor(20), dayDashed(20)]).toEqual(['#59413C', false])
  })

  it('多段日期：整理、天數、小標題對日期', () => {
    expect(
      normalizeSegments([
        { start: '2026-12-13', end: '2026-12-14' },
        { start: '2026-12-01', end: '2026-12-03' },
        { start: '2026-12-04', end: '2026-12-04' },
        { start: '2026-12-09', end: '2026-12-08' },
      ]),
    ).toEqual([
      { start: '2026-12-01', end: '2026-12-04' },
      { start: '2026-12-13', end: '2026-12-14' },
    ])
    const t: Trip = { id: 'a', name: '環島', start: '2026-12-01', end: '2026-12-14', segments: [{ start: '2026-12-01', end: '2026-12-02' }, { start: '2026-12-13', end: '2026-12-14' }], dayTitles: [], titles: { '2026-12-13': '台東' }, coverPhotoId: null, createdAt: 1, updatedAt: 1 }
    expect(tripDates(t)).toEqual(['2026-12-01', '2026-12-02', '2026-12-13', '2026-12-14'])
    expect(tripDaysText(t)).toBe('4 天（2 段）')
    expect(dayTitle(t, '2026-12-13', 2)).toBe('台東')
    // 舊資料：沒有 segments、小標題照順序
    const old: Trip = { id: 'b', name: 'x', start: '2026-10-03', end: '2026-10-04', dayTitles: ['抵達'], coverPhotoId: null, createdAt: 1, updatedAt: 1 }
    expect(tripDaysText(old)).toBe('2 天')
    expect(dayTitle(old, '2026-10-03', 0)).toBe('抵達')
  })

  it('併入其他旅程：日期段合在一起、小標題跟著日期走', () => {
    const a: Trip = { id: 'a', name: '環島', start: '2026-12-01', end: '2026-12-03', dayTitles: ['出發'], coverPhotoId: null, createdAt: 1, updatedAt: 1 }
    const b: Trip = { id: 'b', name: '台東', start: '2026-12-13', end: '2026-12-14', dayTitles: ['池上', ''], coverPhotoId: 'p9', createdAt: 1, updatedAt: 1 }
    const m = mergeTrips(a, [b])
    expect(m.segments).toEqual([
      { start: '2026-12-01', end: '2026-12-03' },
      { start: '2026-12-13', end: '2026-12-14' },
    ])
    expect([m.start, m.end, m.name, m.coverPhotoId]).toEqual(['2026-12-01', '2026-12-14', '環島', 'p9'])
    expect(m.titles).toEqual({ '2026-12-01': '出發', '2026-12-13': '池上' })
  })

  it('多段旅程的統計不算中間沒出門的日子；已建立的段不再建議', () => {
    const t: Trip = { id: 'a', name: 'x', start: '2026-11-01', end: '2026-11-10', segments: [{ start: '2026-11-01', end: '2026-11-01' }, { start: '2026-11-10', end: '2026-11-10' }], dayTitles: [], coverPhotoId: null, createdAt: 1, updatedAt: 1 }
    const s = summarizeTrip(t, [entry({ date: '2026-11-01', amountTwd: 100 }), entry({ date: '2026-11-05', amountTwd: 999 }), entry({ date: '2026-11-10', amountTwd: 50 })], [], [])
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-10'])
    expect(s.expense).toBe(150)
    expect(s.records).toBe(2)
    const away = [pt('2026-11-12', 10, tainan), pt('2026-11-13', 10, tainan), pt('2026-11-14', 20, chiayi)]
    const seg = { start: '2026-11-01', end: '2026-11-20', segments: [{ start: '2026-11-01', end: '2026-11-02' }] }
    expect(suggestTrips([], [...home, ...away], [seg], [], '2026-11-19')).toHaveLength(1)
    expect(suggestTrips([], [...home, ...away], [{ ...seg, segments: [{ start: '2026-11-13', end: '2026-11-13' }] }], [], '2026-11-19')).toHaveLength(0)
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

describe('軌跡影片的時間軸', () => {
  const day = (km: number, label: string) => ({ color: '#59413C', route: [], landmark: null, label, km, photos: 10, expense: 1000, steps: 0 })
  const input = {
    name: '環島', start: '2026-12-01', end: '2026-12-02', days: [day(100, 'Day 1 · 宜蘭'), day(50, 'Day 2 · 花蓮')],
    stats: { km: 150, places: 8, photos: 20, expense: 2000, steps: 0 }, ratio: '9:16', basemap: 'none', showMoney: true, showNames: true, showCredit: true,
  } as PosterInput
  const p = { input, days: input.days.map((d) => ({ day: d, pts: [], cum: [0] })) }

  it('開場：空的地圖、數字 0、標題淡入', () => {
    const f = videoFrameAt(p, 0.4, 15)
    expect(f.progress).toBe(0)
    expect(f.titleAlpha).toBeCloseTo(0.5)
    expect(f.numbers.km).toBe(0)
    expect(f.chip).toBeNull()
  })

  it('中間：一天一天畫、數字往上加、顯示 Day 標籤', () => {
    // 1.5～12 秒畫 2 天 → 第 9.375 秒畫到 1.5 天
    const f = videoFrameAt(p, 9.375, 15)
    expect(f.progress).toBeCloseTo(1.5)
    expect(f.numbers.km).toBe(125)
    expect(f.chip?.text).toBe('Day 2 · 花蓮')
    expect(f.names).toBe(false)
  })

  it('結尾：畫完、數字是總數、地名出現', () => {
    const f = videoFrameAt(p, 13, 15)
    expect(f.progress).toBe(2)
    expect(f.numbers).toEqual(input.stats)
    expect(f.names).toBe(true)
    expect(f.chip).toBeNull()
  })
})

describe('軌跡影片放照片（自動判斷長度）', () => {
  const day = (label: string) => ({ color: '#59413C', route: [], landmark: null, label, km: 10, photos: 2, expense: 0, steps: 0 })
  const input = {
    name: '環島', start: '2026-12-01', end: '2026-12-02', days: [day('Day 1'), day('Day 2')],
    stats: { km: 20, places: 2, photos: 4, expense: 0, steps: 0 }, ratio: '9:16', basemap: 'none', showMoney: true, showNames: true, showCredit: true,
  } as PosterInput
  const p = { input, days: input.days.map((d) => ({ day: d, pts: [], cum: [0] })) }

  it('依照片張數決定長度：每張 1.2 秒＋每天 1.5 秒＋開場結尾', () => {
    const plan = planVideo(2, [0, 0, 1, 1], 'auto')
    expect(plan.photos).toHaveLength(4)
    expect(plan.duration).toBeCloseTo(1.5 + 3 + 2 * 1.5 + 4 * 1.2)
    // 沒照片也至少 10 秒
    expect(planVideo(2, [], 'auto').duration).toBe(10)
  })

  it('照片太多：最長 600 秒，平均挑', () => {
    const days = Array.from({ length: 2000 }, (_, i) => (i < 1000 ? 0 : 1))
    const plan = planVideo(2, days, 'auto')
    expect(plan.duration).toBeLessThanOrEqual(AUTO_MAX_SEC)
    expect(plan.duration).toBeGreaterThan(AUTO_MAX_SEC - 2)
    expect(plan.photos.length).toBeLessThan(2000)
    expect(plan.photos[0].src).toBe(0)
    expect(plan.photos.at(-1)!.src).toBe(1999)
    expect(pickEvenly(5, 3)).toEqual([0, 2, 4])
  })

  it('固定 15 秒：照片最多占 6 成時間', () => {
    const plan = planVideo(2, Array(30).fill(0), 15)
    expect(plan.duration).toBe(15)
    expect(plan.photos.length * plan.photoSec).toBeLessThanOrEqual((15 - 4.5) * 0.6 + 1e-9)
    expect(plan.photoSec).toBeGreaterThanOrEqual(1)
  })

  it('畫到照片時路線停住、照片彈出；播過的照片留在地圖上', () => {
    const plan = planVideo(2, [0, 0, 1, 1], 'auto')
    // 第 1 天：畫 0.5 秒 → 照片 1.2 秒 → 畫 0.5 秒 → 照片 1.2 秒 → 畫 0.5 秒
    const during = videoFrameAt(p, 1.5 + 0.5 + 0.6, plan)
    expect(during.photo?.index).toBe(0)
    expect(during.photo?.phase).toBeCloseTo(0.5)
    expect(during.progress).toBeCloseTo(1 / 3)
    const after = videoFrameAt(p, 1.5 + 0.5 + 1.2 + 0.25, plan)
    expect(after.photo).toBeNull()
    expect(after.shown).toEqual([0])
    expect(after.progress).toBeCloseTo(0.5)
    const end = videoFrameAt(p, plan.duration - 1, plan)
    expect(end.shown).toEqual([0, 1, 2, 3])
    expect(end.progress).toBe(2)
  })
})
