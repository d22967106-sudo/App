import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { dayStays } from './day'
import { carryPoint, computeLegs, guessMode, withCarry } from './legs'
import { decodePolyline, encodePolyline, snapLeg } from './snap'
import type { TrackPoint } from './types'

const home = { lat: 23.48, lng: 120.45 }
const work = { lat: 23.5, lng: 120.5 } // 約 5.6 km

let seq = 0
function at(date: string, hhmm: string, p: { lat: number; lng: number }, accuracy = 10): TrackPoint {
  seq++
  const [h, m] = hhmm.split(':').map(Number)
  const [y, mo, d] = date.split('-').map(Number)
  return { id: `p${seq}`, time: new Date(y, mo - 1, d, h, m).getTime(), date, lat: p.lat, lng: p.lng, accuracy, source: 'auto' }
}
const lerp = (a: { lat: number; lng: number }, b: { lat: number; lng: number }, t: number) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t })

/** 家待到 8 點 → 騎 20 分到公司 → 公司待到 18 點 → 騎回家 */
function commuteDay(date: string): TrackPoint[] {
  const pts: TrackPoint[] = []
  for (const t of ['00:05', '03:00', '06:00', '07:59']) pts.push(at(date, t, home))
  for (let i = 1; i <= 9; i++) pts.push(at(date, `08:${String(i * 2).padStart(2, '0')}`, lerp(home, work, i / 10)))
  for (const t of ['08:20', '10:00', '12:00', '15:00', '17:59']) pts.push(at(date, t, work))
  for (let i = 1; i <= 9; i++) pts.push(at(date, `18:${String(i * 2).padStart(2, '0')}`, lerp(work, home, i / 10)))
  for (const t of ['18:20', '21:00', '23:30']) pts.push(at(date, t, home))
  return pts
}

describe('一天的路線切成好幾段', () => {
  it('依停留切成去程、回程，算出距離和速度', () => {
    const track = commuteDay('2026-11-20')
    const legs = computeLegs(track, dayStays(track))
    expect(legs).toHaveLength(2)
    const [go, back] = legs
    expect(go.from?.fromDayStart).toBe(true)
    expect(go.to?.id).toBe(back.from?.id)
    expect(back.to?.toDayEnd).toBe(true)
    expect(go.km).toBeGreaterThan(5)
    expect(go.km).toBeLessThan(6.5)
    expect(go.avgKmh).toBeGreaterThan(10)
    expect(go.avgKmh).toBeLessThan(25)
    expect(go.id).toBe(`leg-${go.start}`)
  })

  it('停著不動的飄移不算一段', () => {
    const track = ['00:00', '01:00', '02:00', '03:00'].map((t, i) => at('2026-11-21', t, { lat: home.lat + i * 0.0003, lng: home.lng }))
    expect(computeLegs(track, dayStays(track))).toEqual([])
  })

  it('依速度猜交通方式', () => {
    expect(guessMode({ avgKmh: 4, maxKmh: 6 }, 'scooter')).toBe('walk')
    expect(guessMode({ avgKmh: 25, maxKmh: 50 }, 'scooter')).toBe('scooter')
    expect(guessMode({ avgKmh: 25, maxKmh: 50 }, 'car')).toBe('car')
    expect(guessMode({ avgKmh: 120, maxKmh: 250 }, 'scooter')).toBe('none')
  })
})

describe('接上前一天的最後位置', () => {
  it('前一天最後一個可用的點，放在今天 0 點', () => {
    const before = [at('2026-11-19', '18:00', work), at('2026-11-19', '22:10', home), at('2026-11-19', '23:00', work, 999)]
    const c = carryPoint('2026-11-20', before)!
    expect([c.lat, c.lng]).toEqual([home.lat, home.lng])
    expect(c.time).toBe(new Date(2026, 10, 20).getTime())
    expect(c.carriedFrom).toBe(before[1].time)
    expect(carryPoint('2026-11-20', [])).toBeNull()
  })

  it('今天從家出發：第一段從家開始（今天在家沒收到點也一樣）', () => {
    const today = commuteDay('2026-11-20').filter((p) => p.time >= new Date(2026, 10, 20, 8).getTime())
    const carry = carryPoint('2026-11-20', [at('2026-11-19', '22:10', home)])
    const track = withCarry(today, carry)
    const legs = computeLegs(track, dayStays(track))
    expect(legs[0].points[0].lat).toBeCloseTo(home.lat, 4)
  })
})

describe('貼齊道路', () => {
  it('encoded polyline 編碼、解碼', () => {
    // Google 文件的範例（5 位小數）
    const pts = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]
    expect(encodePolyline(pts, 5)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@')
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual(pts)
    const six = [
      { lat: 23.123456, lng: 120.654321 },
      { lat: 23.2, lng: 120.7 },
    ]
    expect(decodePolyline(encodePolyline(six))).toEqual(six)
  })

  it('送到 Valhalla、結果存起來，同樣的點不再送；失敗就回傳 null', async () => {
    const pts = commuteDay('2026-11-22').slice(3, 15)
    const snappedLine = [home, lerp(home, work, 0.5), work]
    let calls = 0
    let lastUrl = ''
    const ok = (async (url: string) => {
      calls++
      lastUrl = url
      return new Response(JSON.stringify({ trip: { legs: [{ shape: encodePolyline(snappedLine) }] } }))
    }) as unknown as typeof fetch
    const r1 = await snapLeg(pts, 'scooter', ok)
    expect(r1?.length).toBe(3)
    expect(decodeURIComponent(lastUrl)).toContain('"costing":"motor_scooter"')
    expect(lastUrl.startsWith('https://valhalla1.openstreetmap.de/trace_route?json=')).toBe(true)
    await snapLeg(pts, 'scooter', ok)
    expect(calls).toBe(1)
    // 不貼齊
    expect(await snapLeg(pts, 'none', ok)).toBeNull()
    // 失敗
    const bad = (async () => new Response('{"error":"no suitable edges"}', { status: 400 })) as unknown as typeof fetch
    expect(await snapLeg(pts.slice(0, 8), 'walk', bad)).toBeNull()
  }, 10000)
})
