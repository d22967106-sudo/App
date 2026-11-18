import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { commonAmount, rankPlaces, rememberPlace } from './places'
import { currencyForCountry, formatCurrency, rateFromPerTwd, toTwd } from './currency'
import { buildRoute, buildTimeline, dayStats } from './day'
import { cleanPath, detectStays } from './stays'
import * as db from './db'
import { countPlaces, distanceM, routeKm } from './geo'
import { finishSearch, overpassNameRegex, parseNominatimSearch, parseOverpass, parsePhotonSearch, shortPlaceName, viewbox } from './geocode'
import {
  formatAmountInput,
  formatDateLong,
  fromDateTimeLocal,
  isDateKey,
  parseAmount,
  relativeDayLabel,
  shiftDate,
  sumMoney,
  toDateTimeLocal,
} from './ledger'
import { fitSize, readExifDate } from './photos'
import type { Entry, Place, TrackPoint } from './types'

let seq = 0
function entry(p: Partial<Entry> = {}): Entry {
  seq++
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
    time: new Date(2026, 10, 17, 9, seq).getTime(),
    date: '2026-11-17',
    location: null,
    photoIds: [],
    placeId: null,
    createdAt: seq,
    updatedAt: seq,
    ...p,
  }
}

const taipei101 = { lat: 25.0339, lng: 121.5645 }
const taipeiMain = { lat: 25.0478, lng: 121.517 }

describe('日期工具', () => {
  it('切換日期跨月跨年', () => {
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('格式化', () => {
    expect(formatDateLong('2026-11-17')).toBe('11月17日 星期二')
    expect(relativeDayLabel('2026-11-16', '2026-11-17')).toBe('昨天')
    expect(relativeDayLabel('2025-11-16', '2026-11-17')).toBe('2025 年')
  })
  it('驗證日期字串', () => {
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(isDateKey('2026-11-17')).toBe(true)
  })
  it('datetime-local 來回轉換', () => {
    const t = new Date(2026, 9, 4, 15, 20).getTime()
    expect(fromDateTimeLocal(toDateTimeLocal(t))).toBe(t)
    expect(fromDateTimeLocal('')).toBeNull()
  })
})

describe('金額', () => {
  it.each([
    ['120', 120],
    ['1,450', 1450],
    ['99.5', 99.5],
    ['0', 0],
    ['0.00', 0],
    ['-5', null],
    ['1.234', null],
    ['', null],
  ])('parseAmount(%s) = %s', (s, v) => expect(parseAmount(s)).toBe(v))

  it.each([
    ['1450', '1,450'],
    ['1234567', '1,234,567'],
    ['1,4500', '14,500'],
    ['12.345', '12.34'],
    ['.5', '0.5'],
    ['1.2.3', '1.23'],
    ['007', '7'],
    ['abc', ''],
  ])('輸入時加千分位 %s → %s', (s, v) => expect(formatAmountInput(s)).toBe(v))

  it('加千分位後仍可解析', () => {
    expect(parseAmount(formatAmountInput('1450.5'))).toBe(1450.5)
  })

  it('加總沒有浮點誤差', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3)
  })
})

describe('多幣別', () => {
  it('換算匯率與台幣', () => {
    // 1 TWD = 4.755 JPY → 1 JPY ≈ 0.2103 TWD
    const r = rateFromPerTwd({ JPY: 4.755 }, 'JPY')
    expect(r).toBe(0.2103)
    expect(toTwd(1450, r!)).toBe(305)
    expect(rateFromPerTwd({}, 'JPY')).toBeNull()
    expect(rateFromPerTwd({}, 'TWD')).toBe(1)
  })
  it('依國家建議幣別', () => {
    expect(currencyForCountry('JP')).toBe('JPY')
    expect(currencyForCountry('fr')).toBe('EUR')
    expect(currencyForCountry('zz')).toBeNull()
  })
  it('格式化', () => {
    expect(formatCurrency(1450, 'JPY')).toBe('¥1,450')
    expect(formatCurrency(1240, 'TWD')).toBe('NT$1,240')
    expect(formatCurrency(12.5, 'USD')).toBe('US$12.5')
  })
})

describe('地理', () => {
  it('距離與路線長度', () => {
    const d = distanceM(taipei101, taipeiMain)
    expect(d).toBeGreaterThan(4800)
    expect(d).toBeLessThan(5200)
    expect(routeKm([taipei101, taipeiMain, taipei101])).toBeCloseTo(10, 0)
  })
  it('相近的點算同一個地點', () => {
    const near = { lat: 25.034, lng: 121.5646 }
    expect(countPlaces([taipei101, near, taipeiMain])).toBe(2)
  })
})

describe('地名與附近店家', () => {
  it('組出短地名', () => {
    expect(shortPlaceName({ neighbourhood: '祇園', city: '京都市' })).toBe('祇園 · 京都市')
    expect(shortPlaceName({ suburb: '信義區', city: '臺北市' })).toBe('信義區 · 臺北市')
    expect(shortPlaceName({ country: '日本' })).toBe('日本')
  })
  it('解析 Overpass 結果並依距離排序、去重', () => {
    const json = {
      elements: [
        { type: 'node', id: 1, lat: 25.0345, lon: 121.5645, tags: { name: '拉麵店', amenity: 'restaurant' } },
        { type: 'way', id: 2, center: { lat: 25.034, lon: 121.5645 }, tags: { name: '7-ELEVEN', shop: 'convenience' } },
        { type: 'node', id: 3, lat: 25.034, lon: 121.5645, tags: { amenity: 'bench' } },
        { type: 'node', id: 4, lat: 25.0346, lon: 121.5645, tags: { name: '拉麵店', amenity: 'restaurant' } },
      ],
    }
    const r = parseOverpass(json, taipei101)
    expect(r.map((s) => s.name)).toEqual(['7-ELEVEN', '拉麵店'])
    expect(r[0].categoryId).toBe('daily')
    expect(r[1]).toMatchObject({ categoryId: 'food', kindLabel: '餐廳' })
  })
})

describe('店名搜尋', () => {
  it('解析 Nominatim 搜尋結果，略過道路', () => {
    const r = parseNominatimSearch(
      [
        { osm_type: 'node', osm_id: 1, lat: '25.034', lon: '121.565', name: '鼎泰豐', category: 'amenity', type: 'restaurant' },
        { osm_type: 'way', osm_id: 2, lat: '25.035', lon: '121.565', name: '鼎泰路', category: 'highway', type: 'residential' },
      ],
      taipei101,
    )
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ name: '鼎泰豐', categoryId: 'food', kindLabel: '餐廳' })
  })

  it('解析 Photon 搜尋結果', () => {
    const r = parsePhotonSearch(
      {
        features: [
          { geometry: { coordinates: [121.565, 25.034] }, properties: { name: '誠品', osm_key: 'shop', osm_value: 'books', osm_type: 'N', osm_id: '3' } },
          { geometry: { coordinates: [121.5, 25.0] }, properties: { name: '信義區', osm_key: 'place', osm_value: 'suburb' } },
        ],
      },
      taipei101,
    )
    expect(r.map((s) => s.name)).toEqual(['誠品'])
    expect(r[0]).toMatchObject({ categoryId: 'shopping', kindLabel: '書店' })
  })

  it('搜尋結果近的排前面，連鎖店分店都保留，太遠的去掉', () => {
    const shop = (name: string, lat: number) => ({
      osmId: name + lat, name, lat, lng: taipei101.lng, distance: 0, categoryId: null, kindLabel: '',
    })
    const r = finishSearch(
      [shop('7-ELEVEN', 25.06), shop('7-ELEVEN', 25.035), shop('7-ELEVEN', 25.03501), shop('7-ELEVEN', 26)],
      taipei101,
      30000,
    )
    expect(r.map((s) => s.lat)).toEqual([25.035, 25.06])
  })

  it('viewbox 約為上下左右各 2 公里', () => {
    const [l, t, rr, b] = viewbox(taipei101, 2000).split(',').map(Number)
    expect(distanceM({ lat: t, lng: taipei101.lng }, { lat: b, lng: taipei101.lng })).toBeCloseTo(4000, -2)
    expect(distanceM({ lat: taipei101.lat, lng: l }, { lat: taipei101.lat, lng: rr })).toBeCloseTo(4000, -2)
  })

  it('跳脫特殊字元、空白變成任意字元', () => {
    expect(overpassNameRegex('一蘭')).toBe('一蘭')
    expect(overpassNameRegex(' 7-11 便利 ')).toBe('7-11.*便利')
    expect(overpassNameRegex('a.b(c)')).toBe('a\\\\.b\\\\(c\\\\)')
    expect(overpassNameRegex('say "hi"')).toBe('say.*hi')
  })
})

describe('一天的路線與統計', () => {
  it('定位與紀錄依時間合併', () => {
    const e1 = entry({ location: taipeiMain, amountTwd: 65, time: 2 })
    const e2 = entry({ kind: 'diary', amount: null, amountTwd: null, time: 3, photoIds: ['p1', 'p2'] })
    const tp: TrackPoint = { id: 't1', time: 1, date: '2026-11-17', ...taipei101, source: 'checkin' }
    expect(buildRoute([e1, e2], [tp]).map((p) => p.ref.id)).toEqual(['t1', e1.id])
    expect(buildTimeline([e2, e1], [tp]).map((i) => i.time)).toEqual([1, 2, 3])
    const s = dayStats([e1, e2, entry({ kind: 'income', amountTwd: 500 })], [tp])
    expect(s).toMatchObject({ expense: 65, income: 500, places: 2, records: 3, photos: 2 })
    expect(s.km).toBeCloseTo(5, 0)
  })
})

describe('背景定位：停留與路線', () => {
  const home = { lat: 23.48, lng: 120.45 }
  const office = { lat: 23.47, lng: 120.43 } // 約 2 公里外
  const min = 60_000
  const auto = (i: number, p: { lat: number; lng: number }, jitter = 0): TrackPoint => ({
    id: `auto-${i}`, time: i * min, date: '2026-11-18', lat: p.lat + jitter, lng: p.lng, accuracy: 10, source: 'auto',
  })
  // 0–30 分在家（小飄移），31–40 分在路上，41–90 分在公司
  const day: TrackPoint[] = [
    ...Array.from({ length: 31 }, (_, i) => auto(i, home, (i % 3) * 0.0001)),
    ...Array.from({ length: 10 }, (_, k) => auto(31 + k, { lat: home.lat + ((office.lat - home.lat) * (k + 1)) / 11, lng: home.lng + ((office.lng - home.lng) * (k + 1)) / 11 })),
    ...Array.from({ length: 50 }, (_, k) => auto(41 + k, office)),
  ]

  it('找出停留：家（從一早開始）、公司（到最後）', () => {
    const stays = detectStays(day)
    expect(stays).toHaveLength(2)
    expect(stays[0]).toMatchObject({ start: 0, end: 30 * min, fromDayStart: true, toDayEnd: false })
    expect(stays[1]).toMatchObject({ start: 41 * min, end: 90 * min, fromDayStart: false, toDayEnd: true })
  })

  it('時間軸只顯示「離開家」「抵達公司」，不列出每個點', () => {
    const tl = buildTimeline([], day)
    expect(tl.map((i) => (i.type === 'stay' ? i.edge : i.type))).toEqual(['leave', 'arrive'])
  })

  it('停著不動的飄移不算距離；地點數只算停留的地方', () => {
    const s = dayStats([], day)
    expect(s.places).toBe(2)
    expect(s.km).toBeGreaterThan(2)
    expect(s.km).toBeLessThan(2.6)
    expect(cleanPath(day.slice(0, 31))).toHaveLength(1)
  })

  it('精確度太差的點不畫進路線', () => {
    const bad: TrackPoint = { ...auto(5, { lat: 25, lng: 121 }), accuracy: 900 }
    expect(buildRoute([], [auto(1, home), bad]).map((p) => p.ref.id)).toEqual(['auto-1'])
  })
})

describe('照片', () => {
  it('依長邊縮放，不放大', () => {
    expect(fitSize(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 })
    expect(fitSize(300, 200, 400)).toEqual({ width: 300, height: 200 })
  })
  it('讀出 EXIF 拍攝時間', () => {
    expect(readExifDate(makeJpegWithExif('2026:10:04 15:20:33'))).toBe(
      new Date(2026, 9, 4, 15, 20, 33).getTime(),
    )
    expect(readExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toBeNull()
    expect(readExifDate(new Uint8Array([1, 2, 3]).buffer)).toBeNull()
  })
})

describe('記住去過的店', () => {
  beforeEach(async () => {
    await db.resetDBForTests()
    indexedDB.deleteDatabase('ledger-diary')
  })

  it('最常見的金額', () => {
    expect(commonAmount([65, 80, 65, 90])).toBe(65)
    expect(commonAmount([65, 80])).toBe(80)
    expect(commonAmount([])).toBeNull()
  })

  it('同名同地點累計次數，編輯同一筆不重複計算', async () => {
    const e = entry({ title: '捷運站旁咖啡', amount: 65, location: taipei101 })
    const id = await rememberPlace(e)
    const again = await rememberPlace({ ...e, placeId: id })
    expect(again).toBe(id)
    const second = await rememberPlace(entry({ title: '捷運站旁咖啡', amount: 80, location: taipei101 }))
    expect(second).toBe(id)
    const [p] = await db.getAllPlaces()
    expect(p).toMatchObject({ visits: 2, recentAmounts: [65, 80] })
    // 別的地方同名的店是另一家
    await rememberPlace(entry({ title: '捷運站旁咖啡', location: taipeiMain }))
    expect(await db.getAllPlaces()).toHaveLength(2)
  })

  it('排序：常去的優先，太遠的不列', () => {
    const mk = (name: string, visits: number, lat: number): Place => ({
      id: name, name, lat, lng: taipei101.lng, categoryId: null, recentAmounts: [], currency: 'TWD', visits, lastVisit: 0,
    })
    const r = rankPlaces([mk('近', 1, 25.0340), mk('常去', 5, 25.0350), mk('遠', 9, 25.1)], taipei101)
    expect(r.map((s) => s.place.name)).toEqual(['常去', '近'])
  })
})

describe('資料庫', () => {
  beforeEach(async () => {
    await db.resetDBForTests()
    indexedDB.deleteDatabase('ledger-diary')
  })

  it('儲存紀錄時清掉不用的照片、刪除紀錄連照片一起刪', async () => {
    const e = entry({ photoIds: ['a', 'b'] })
    const photo = (id: string) => ({
      id, entryId: e.id, thumb: new Blob(['x']), display: null, width: 1, height: 1, takenAt: null, createdAt: 0,
    })
    await db.saveEntry(e, [photo('a'), photo('b')])
    await db.saveEntry({ ...e, photoIds: ['b'] })
    expect(await db.getPhoto('a')).toBeUndefined()
    expect(await db.getPhoto('b')).toBeDefined()
    expect(await db.getEntriesByDate('2026-11-17')).toHaveLength(1)
    await db.deleteEntry(e.id)
    expect(await db.getPhoto('b')).toBeUndefined()
    expect(await db.getEntriesByDate('2026-11-17')).toHaveLength(0)
  })

  it('空白的每日總結會被刪掉', async () => {
    await db.saveSummary({ date: '2026-11-17', text: '很滿的一天', mood: 'good', updatedAt: 1 })
    expect((await db.getSummary('2026-11-17'))?.text).toBe('很滿的一天')
    await db.saveSummary({ date: '2026-11-17', text: '  ', mood: null, updatedAt: 2 })
    expect(await db.getSummary('2026-11-17')).toBeUndefined()
  })
})

/** 產生一個只有 EXIF DateTimeOriginal 的最小 JPEG 標頭 */
function makeJpegWithExif(date: string): ArrayBuffer {
  const str = new TextEncoder().encode(date + '\0') // 20 bytes
  // TIFF（big endian）：header 8 + IFD0(1 entry) 18 + ExifIFD(1 entry) 18 + 字串 20
  const tiff = new Uint8Array(8 + 18 + 18 + str.length)
  const v = new DataView(tiff.buffer)
  v.setUint16(0, 0x4d4d)
  v.setUint16(2, 42)
  v.setUint32(4, 8)
  v.setUint16(8, 1) // IFD0 一個欄位
  v.setUint16(10, 0x8769)
  v.setUint16(12, 4)
  v.setUint32(14, 1)
  v.setUint32(18, 26) // ExifIFD 位置
  v.setUint32(22, 0)
  v.setUint16(26, 1)
  v.setUint16(28, 0x9003)
  v.setUint16(30, 2)
  v.setUint32(32, str.length)
  v.setUint32(36, 44) // 字串位置
  v.setUint32(40, 0)
  tiff.set(str, 44)
  const app1Len = 2 + 6 + tiff.length
  const out = new Uint8Array(2 + 2 + app1Len + 2)
  const o = new DataView(out.buffer)
  o.setUint16(0, 0xffd8)
  o.setUint16(2, 0xffe1)
  o.setUint16(4, app1Len)
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6)
  out.set(tiff, 12)
  o.setUint16(12 + tiff.length, 0xffd9)
  return out.buffer
}
