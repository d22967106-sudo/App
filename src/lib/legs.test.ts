import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { dayStays } from './day'
import { carryPoint, computeLegs, dropWobble, guessMode, withCarry } from './legs'
import { decodePolyline, encodePolyline, snapDrawn, snapLeg, spliceLine, thin, tidySnapped } from './snap'
import { distanceM } from './geo'
import type { TrackPoint } from './types'

/** 點離折線多近（公尺，每段切 20 份取樣，測試用） */
function distToLine(line: { lat: number; lng: number }[], p: { lat: number; lng: number }): number {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++)
    for (let k = 0; k <= 20; k++) {
      const q = { lat: line[i].lat + ((line[i + 1].lat - line[i].lat) * k) / 20, lng: line[i].lng + ((line[i + 1].lng - line[i].lng) * k) / 20 }
      best = Math.min(best, distanceM(q, p))
    }
  if (line.length === 1) best = distanceM(line[0], p)
  return best
}


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
    expect(r1).not.toBeNull()
    expect(pts.every((q) => distToLine(r1!, q) <= 50)).toBe(true)
    expect(decodeURIComponent(lastUrl)).toContain('"costing":"motor_scooter"')
    // 對軌跡不管單行道、禁止迴轉
    expect(decodeURIComponent(lastUrl)).toContain('"costing_options":{"motor_scooter":{"ignore_oneways":true,"ignore_restrictions":true,"ignore_access":true}}')
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
    expect(r).not.toBeNull()
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

describe('貼齊後對回實際的點（實際的點是事實，路線一定經過）', () => {
  // lat 每 0.000009 度約 1 m（南北），lng 每 0.0000098 度約 1 m（東西，緯度 23.5）
  const P = (south: number, east = 0) => ({ lat: home.lat - south * 0.000009, lng: home.lng + east * 0.0000098 })
  // 每個實際的點都在路線旁邊、誤差範圍內（測試的點精確度都是 10 m 以下 → 容許 20 m）
  const hasAll = (out: { lat: number; lng: number }[], raw: { lat: number; lng: number }[]) => raw.every((r) => distToLine(out, r) <= 20)

  it('騎過頭迴轉、貼齊繞街區一圈：照實際的點折返，每個點都在路線上', () => {
    const raw = [0, 50, 100, 150, 200, 250, 300, 250, 200, 150].map((m) => P(m))
    const snapped = [P(0), P(100), P(200), P(250), P(250, 100), P(350, 100), P(350, 0), P(300), P(250), P(200), P(150)]
    const out = tidySnapped(snapped, raw)
    expect(hasAll(out, raw)).toBe(true)
    expect(out.every((p) => Math.abs(p.lng - home.lng) / 0.0000098 < 10)).toBe(true)
  })

  it('實際那次的小街區（約 47 × 55 m）：不繞街區', () => {
    const raw = [P(0), P(40), P(80), P(85, 3), P(160), P(80), P(78, 2), P(82)]
    const snapped = [P(0), P(40), P(80), P(105), P(105, 47), P(160, 47), P(160), P(130), P(105), P(80)]
    const out = tidySnapped(snapped, raw)
    expect(hasAll(out, raw)).toBe(true)
    expect(out.every((p) => Math.abs(p.lng - home.lng) / 0.0000098 < 10)).toBe(true)
  })

  it('迴轉（下一個點在上一個點後面）：貼齊只多繞一個小圈也不用，照實際的點折返', () => {
    // 往南 0 → 100 → 200 迴轉 → 100；貼齊在 200 m 那裡往東繞了 15 × 20 m 的小圈（多 30 m，一般標準會放過）
    const raw = [P(0), P(100), P(200), P(100)]
    const snapped = [P(0), P(100), P(190), P(190, 15), P(210, 15), P(210), P(200), P(100)]
    const out = tidySnapped(snapped, raw)
    expect(hasAll(out, raw)).toBe(true)
    expect(out.every((p) => Math.abs(p.lng - home.lng) / 0.0000098 < 5)).toBe(true)
  })

  it('兩點之間的路本來就彎出去 80 m：照貼齊的彎路畫', () => {
    const raw = [P(0), P(300), P(600)]
    const snapped = [P(0), P(100, 50), P(150, 80), P(200, 50), P(300), P(450, -70), P(600)]
    expect(tidySnapped(snapped, raw)).toEqual(snapped)
  })

  it('貼齊線漏掉一個實際的點：還是會經過那個點', () => {
    const raw = [P(0), P(100), P(150, 60), P(200), P(300)]
    const snapped = [P(0), P(100), P(200), P(300)]
    const out = tidySnapped(snapped, raw)
    expect(hasAll(out, raw)).toBe(true)
  })
})

describe('2026-11-22 使用者手繪路線對照', () => {
  const P = (south: number, east = 0) => ({ lat: home.lat - south * 0.000009, lng: home.lng + east * 0.0000098 })
  const T = (sec: number, south: number, east: number, accuracy: number): TrackPoint => ({
    id: `t${sec}`, time: new Date(2026, 10, 21, 23, 32).getTime() + sec * 1000, date: '2026-11-21', ...P(south, east), accuracy, source: 'auto',
  })

  it('走路回家（實際 23:32:25～23:34:39 的相對位置），32:56 那點飄到馬路對面：畫線時跳過', () => {
    // 原始點減掉第一點、換算成公尺（往南、往東）
    const real: [string, number, number, number][] = [
      ['32:25', 25.054015, 121.451181, 14],
      ['32:56', 25.053697, 121.451412, 14],
      ['33:30', 25.053495, 121.451331, 19],
      ['34:07', 25.053157, 121.451281, 17],
      ['34:39', 25.053113, 121.451101, 16],
    ]
    const walk = real.map(([, lat, lng, acc], i) => T(i * 32, (real[0][1] - lat) * 111320, (lng - real[0][2]) * 100890, acc))
    walk.forEach((p, i) => (p.id = real[i][0]))
    const out = dropWobble(walk).map((p) => p.id)
    expect(out).not.toContain('32:56')
    expect(out[0]).toBe('32:25')
    expect(out.at(-1)).toBe('34:39')
  })

  it('真的轉彎（偏離比誤差大很多）不會被跳過', () => {
    const turn = [T(0, 0, 0, 8), T(30, 200, 0, 8), T(60, 200, 200, 8)]
    expect(dropWobble(turn)).toHaveLength(3)
  })

  it('同一條直路往返，點在路兩旁 ±10 m：畫在路上，沒有突出的折線', () => {
    const raw = [T(0, 0, 8, 10), T(30, 150, -9, 10), T(60, 300, 10, 10), T(90, 150, -8, 10), T(120, 0, 9, 10)]
    // 貼齊道路：都在 east = 0 那條路上
    const snapped = [P(0), P(150), P(300), P(150), P(0)]
    const out = tidySnapped(snapped, raw)
    expect(out.every((p) => Math.abs(p.lng - home.lng) / 0.0000098 < 1)).toBe(true)
  })

  it('30 秒內繞進巷子再出來（比直線長很多但騎得到）：照貼齊的巷子畫', () => {
    // 時速約 36 km/h；兩點直線 50 m，實際往西 50、往北 30、往東 50（130 m）
    const raw = [T(0, 0, 300, 8), T(30, 0, 0, 8), T(61, -30, 0, 8)]
    const snapped = [P(0, 300), P(0, 0), P(0, -50), P(-30, -50), P(-30, 0)]
    const out = tidySnapped(snapped, raw)
    expect(out.some((p) => (p.lng - home.lng) / 0.0000098 < -45)).toBe(true)
  })
})

describe('手繪修改路線', () => {
  const P = (south: number, east = 0) => ({ lat: home.lat - south * 0.000009, lng: home.lng + east * 0.0000098 })
  it('畫的線送去貼齊道路（太近的點去掉）；失敗就用畫的線', async () => {
    const drawn = Array.from({ length: 101 }, (_, i) => P(i * 3, 12)) // 300 m、每 3 m 一點、畫在路旁 12 m
    const road = [P(0), P(300)]
    let url = ''
    const ok = (async (u: string) => {
      url = decodeURIComponent(u)
      return new Response(JSON.stringify({ trip: { legs: [{ shape: encodePolyline(road) }] } }))
    }) as unknown as typeof fetch
    expect(await snapDrawn(drawn, 'walk', ok)).toEqual(road.map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 })))
    expect(url).toContain('"costing":"pedestrian"')
    const sent = decodePolyline(JSON.parse(url.split('json=')[1]).encoded_polyline)
    expect(sent.length).toBeLessThan(45) // 3 m 一點 → 8 m 以上才留
    const bad = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    const fallback = await snapDrawn(drawn, 'scooter', bad)
    expect(fallback[0]).toEqual(drawn[0])
    expect(fallback.at(-1)).toEqual(drawn.at(-1))
  }, 10000)
})

describe('局部手繪：只換掉畫的那一小段', () => {
  const P = (south: number, east = 0) => ({ lat: home.lat - south * 0.000009, lng: home.lng + east * 0.0000098 })
  // 原本的線：往南 1 km（每 100 m 一點）
  const base = Array.from({ length: 11 }, (_, i) => P(i * 100))
  const eastOf = (p: { lng: number }) => (p.lng - home.lng) / 0.0000098
  const southOf = (p: { lat: number }) => (home.lat - p.lat) / 0.000009

  it('從 300 m 處畫到 500 m 處（往東繞 60 m）：只換中間，前後不動', () => {
    const piece = [P(300, 5), P(320, 60), P(480, 60), P(500, 5)]
    const out = spliceLine(base, piece)
    expect(out.slice(0, 4)).toEqual(base.slice(0, 4))
    expect(out.slice(-6)).toEqual(base.slice(-6))
    expect(out.some((p) => eastOf(p) > 50)).toBe(true)
    // 換掉的範圍外沒有往東的點
    expect(out.filter((p) => eastOf(p) > 10).every((p) => southOf(p) > 300 && southOf(p) < 500)).toBe(true)
  })

  it('反方向畫（從 500 m 畫回 300 m）也一樣', () => {
    const piece = [P(500, 5), P(480, 60), P(320, 60), P(300, 5)]
    const out = spliceLine(base, piece)
    expect(out.slice(0, 4)).toEqual(base.slice(0, 4))
    const south = out.map(southOf)
    // 照順序往南（不會倒著走回去）
    for (let i = 1; i < south.length; i++) expect(south[i]).toBeGreaterThanOrEqual(south[i - 1] - 25)
  })

  it('頭尾離原本的線超過 80 m：整段換掉', () => {
    const piece = [P(0, 200), P(1000, 200)]
    expect(spliceLine(base, piece)).toEqual(piece)
  })
})
