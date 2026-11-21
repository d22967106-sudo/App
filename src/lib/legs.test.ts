import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { dayStays } from './day'
import { carryPoint, computeLegs, guessMode, withCarry } from './legs'
import { decodePolyline, encodePolyline, fixDetours, snapLeg, thin } from './snap'
import { distanceM } from './geo'
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

  it('走路點稀疏、誤差大：比對時告訴 Valhalla 精確度；比對失敗就沿道路規劃路線串起來', async () => {
    const walk = [0, 1, 2, 3, 4].map((k) => at('2026-11-23', `09:0${k}`, lerp(home, { lat: home.lat, lng: home.lng - 0.0015 }, k / 4), 50))
    const urls: string[] = []
    const line = [home, { lat: home.lat, lng: home.lng - 0.0015 }]
    const fake = (async (url: string) => {
      urls.push(decodeURIComponent(url))
      if (url.includes('/trace_route')) return new Response('{"error":"Map Match algorithm failed"}', { status: 400 })
      return new Response(JSON.stringify({ trip: { legs: [{ shape: encodePolyline(line) }] } }))
    }) as unknown as typeof fetch
    const r = await snapLeg(walk, 'walk', fake)
    expect(r).toHaveLength(2)
    expect(urls[0]).toContain('"gps_accuracy":50')
    expect(urls[0]).toContain('"search_radius":75')
    expect(urls[0]).toContain('"turn_penalty_factor":500')
    expect(urls[1].startsWith('https://valhalla1.openstreetmap.de/route?json=')).toBe(true)
    expect(urls[1]).toContain('"costing":"pedestrian"')
    expect(urls[1]).toContain('"type":"via"')
  }, 10000)
})

describe('短距離走路（2026-11-21 使用者回報走路沒畫出來）', () => {
  const D = '2026-11-22'
  const t0 = new Date(2026, 10, 22, 9, 0).getTime()
  // 往西走 lng 每 0.0001 度約 10 公尺
  const pt = (sec: number, dx: number, accuracy = 10, dy = 0): TrackPoint => ({
    id: `w${sec}`, time: t0 + sec * 1000, date: D, lat: home.lat + dy * 0.00009, lng: home.lng - dx * 0.0000098, accuracy, source: 'auto',
  })
  const atHome = (fromSec: number, toSec: number, accuracy = 10) => {
    const out: TrackPoint[] = []
    for (let s = fromSec; s <= toSec; s += 300) out.push(pt(s, (s / 300) % 2 ? 4 : 0, accuracy))
    return out
  }

  it('走到 150 公尺外的巷口買東西（停 3 分鐘）再走回家：算一段走路', () => {
    const walk: TrackPoint[] = []
    // 30 秒一點，時速約 4.3 km/h（每點 36 m）
    for (let k = 1; k <= 4; k++) walk.push(pt(1800 + k * 30, k * 36))
    walk.push(pt(1800 + 150 + 180, 150))
    for (let k = 1; k <= 4; k++) walk.push(pt(1800 + 330 + k * 30, 150 - k * 36))
    const track = [...atHome(0, 1800), ...walk, ...atHome(2400, 5400)]
    const stays = dayStays(track)
    expect(stays).toHaveLength(2)
    const legs = computeLegs(track, stays)
    expect(legs).toHaveLength(1)
    expect(legs[0].km).toBeGreaterThanOrEqual(0.2)
    expect(guessMode(legs[0], 'scooter')).toBe('walk')
  })

  it('在家用 Wi-Fi 定位（±65 m）飄來飄去：不算出門', () => {
    const drift = [0, 60, -40, 70, 20, -60, 50, 0, 80, -30, 40, 0].map((dx, i) => pt(i * 600, dx, 65, (i % 3) - 1))
    const stays = dayStays(drift)
    expect(stays).toHaveLength(1)
    expect(computeLegs(drift, stays)).toEqual([])
  })

  it('在家時一個點飄到 70 公尺外：不會切成兩段停留', () => {
    const track = [...atHome(0, 1800), pt(1830, 70, 20), ...atHome(2100, 4200)]
    const stays = dayStays(track)
    expect(stays).toHaveLength(1)
    expect(computeLegs(track, stays)).toEqual([])
  })
})

describe('挑點', () => {
  it('平均挑、留頭尾', () => {
    expect(thin([1, 2, 3], 5)).toEqual([1, 2, 3])
    const t = thin(Array.from({ length: 100 }, (_, i) => i), 20)
    expect(t).toHaveLength(20)
    expect(t[0]).toBe(0)
    expect(t[19]).toBe(99)
  })
})

describe('貼齊道路繞路修正（2026-11-21 騎過頭迴轉，貼齊後繞街區一圈）', () => {
  // 往南騎 300 m 迴轉、往北騎回 150 m；lat 每 0.00009 度約 10 m，lng 每 0.0000098 度約 1 m（緯度 23.5）
  const P = (south: number, east = 0) => ({ lat: home.lat - south * 0.000009, lng: home.lng + east * 0.0000098 })
  const raw = [0, 50, 100, 150, 200, 250, 300, 250, 200, 150].map((m) => P(m))
  it('繞街區那段改回照實際的點畫，迴轉的地方保留', () => {
    // 貼齊結果：往南到 250 m → 往東 100 → 往南 100 → 往西 100（到 350 m）→ 往北回到原路 → 回到 150 m
    const snapped = [P(0), P(100), P(200), P(250), P(250, 100), P(350, 100), P(350, 0), P(300), P(250), P(200), P(150)]
    const fixed = fixDetours(snapped, raw)
    const maxOff = Math.max(...fixed.map((p) => Math.min(...raw.map((r) => distanceM(p, r)))))
    expect(maxOff).toBeLessThan(60)
    expect(fixed.some((p) => distanceM(p, P(300)) < 5)).toBe(true)
  })
  it('沒有繞路就不動', () => {
    const snapped = [P(0, 5), P(150, 8), P(300, 5), P(150, 3)]
    expect(fixDetours(snapped, raw)).toEqual(snapped)
  })
})

describe('貼齊道路繞路修正：彎路不算繞路', () => {
  it('兩點之間的路本來就彎出去 80 m：保留貼齊的線', () => {
    const P = (south: number, east = 0) => ({ lat: home.lat - south * 0.000009, lng: home.lng + east * 0.0000098 })
    const raw = [P(0), P(300), P(600)]
    const snapped = [P(0), P(100, 50), P(150, 80), P(200, 50), P(300), P(450, -70), P(600)]
    expect(fixDetours(snapped, raw)).toEqual(snapped)
  })
})

describe('貼齊道路繞路修正：實際那次的小街區（約 47 × 55 m）', () => {
  it('迴轉處繞了一個小街區、那裡沒有任何點：改回原路折返', () => {
    const P = (south: number, east = 0) => ({ lat: home.lat - south * 0.000009, lng: home.lng + east * 0.0000098 })
    // 往南騎到 0 → 80 m 處一群點（目的地附近）→ 160 m 迴轉 → 回到 80 m
    const raw = [P(0), P(40), P(80), P(85, 3), P(160), P(80), P(78, 2), P(82)]
    // 貼齊：往南到 105 m（公園路口）→ 東 47 → 南 55 → 西 47（160 m，中華路口）→ 北回 80 m
    const snapped = [P(0), P(40), P(80), P(105), P(105, 47), P(160, 47), P(160), P(130), P(105), P(80)]
    const fixed = fixDetours(snapped, raw)
    const maxOff = Math.max(...fixed.map((p) => Math.min(...raw.map((r) => distanceM(p, r)))))
    expect(fixed.every((p) => Math.abs(p.lng - home.lng) / 0.0000098 < 10)).toBe(true) // 沒有偏到東邊的街區
    expect(fixed.some((p) => distanceM(p, P(160)) < 5)).toBe(true) // 迴轉的地方還在
    void maxOff
  })
})
