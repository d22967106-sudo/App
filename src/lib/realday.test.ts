import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { dayStays } from './day'
import { carryPoint, computeLegs, guessMode, withCarry } from './legs'
import type { TrackPoint } from './types'

/**
 * 使用者 2026-11-21 的真實背景定位（Overland，約 30 秒一點），座標整體平移到假的位置（相對距離不變）。
 * 早上：07:18 從家往西走約 90 m 到早餐店、待到 07:56、走回家；晚上 22:16 騎車往南約 1.4 km。
 * 問題：早上那兩段走路以前不見了（停留的範圍把走路的點吃掉，中間剩一兩個點、不到 80 m 被丟掉）。
 */
const RAW = [
  '07:17:58,23.479959,120.449902,18',
  '07:18:32,23.479814,120.449617,19',
  '07:19:08,23.479814,120.449150,20',
  '07:19:40,23.479785,120.448997,21',
  '07:20:11,23.479788,120.449097,19',
  '07:20:52,23.479800,120.448993,15',
  '07:33:55,23.479851,120.449077,29',
  '07:34:34,23.479808,120.448971,16',
  '07:36:28,23.479793,120.449096,58',
  '07:38:59,23.479812,120.448998,10',
  '07:56:06,23.479781,120.449095,20',
  '07:56:59,23.479880,120.449002,26',
  '07:57:48,23.479812,120.448927,14',
  '07:58:21,23.479790,120.449211,18',
  '07:58:53,23.479786,120.449472,17',
  '07:59:24,23.479919,120.449811,17',
  '07:59:58,23.480121,120.450166,14',
  '22:14:10,23.480077,120.450023,16',
  '22:14:40,23.479864,120.449811,12',
  '22:15:12,23.479797,120.449618,17',
  '22:15:43,23.479963,120.449800,21',
  '22:16:20,23.479798,120.449659,22',
  '22:16:51,23.479656,120.449790,5',
  '22:17:22,23.479191,120.450989,9',
  '22:17:52,23.479344,120.451298,8',
  '22:18:22,23.478059,120.451830,8',
  '22:18:53,23.477542,120.451845,12',
  '22:19:24,23.474725,120.451810,8',
  '22:19:55,23.472020,120.452473,8',
  '22:20:25,23.471481,120.452036,8',
  '22:20:55,23.470873,120.451712,14',
  '22:21:26,23.468329,120.451631,2',
  '22:22:05,23.468189,120.451619,3',
  '22:22:36,23.466869,120.451343,8',
  '22:23:12,23.467671,120.451439,30',
  '22:23:44,23.467529,120.451457,33',
  '22:24:21,23.467655,120.451456,23',
  '22:25:05,23.467653,120.451596,55',
  '22:25:38,23.467594,120.451485,38',
  '22:26:45,23.467659,120.451585,27',
  '22:27:56,23.467509,120.451486,86',
  '22:28:28,23.467689,120.451571,26',
  '22:29:19,23.467778,120.451498,107',
  '22:29:51,23.467598,120.451431,40',
]

function track(date = '2026-11-21'): TrackPoint[] {
  const [y, m, d] = date.split('-').map(Number)
  return RAW.map((line, i) => {
    const [t, lat, lng, acc] = line.split(',')
    const [hh, mm, ss] = t.split(':').map(Number)
    return { id: `r${i}`, time: new Date(y, m - 1, d, hh, mm, ss).getTime(), date, lat: Number(lat), lng: Number(lng), accuracy: Number(acc), source: 'auto' as const }
  })
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

describe('真實的一天（2026-11-21）', () => {
  it('早上走去早餐店、走回家，晚上騎車：三段', () => {
    const t = track()
    const legs = computeLegs(t, dayStays(t))
    const summary = legs.map((l) => `${hhmm(l.start)}-${hhmm(l.end)} ${guessMode(l, 'scooter')}`)
    expect(summary).toHaveLength(3)
    expect(legs[0].start).toBeLessThan(new Date(2026, 10, 21, 7, 21).getTime())
    expect(guessMode(legs[0], 'scooter')).toBe('walk')
    expect(hhmm(legs[1].start) >= '07:56' && hhmm(legs[1].end) <= '08:00').toBe(true)
    expect(guessMode(legs[1], 'scooter')).toBe('walk')
    expect(hhmm(legs[2].start) >= '22:14').toBe(true)
    expect(guessMode(legs[2], 'scooter')).toBe('scooter')
    expect(legs[2].km).toBeGreaterThan(1.2)
  })

  it('前一天最後在家（有延續點）也一樣抓得到早上的走路', () => {
    const t = track()
    const carry = carryPoint('2026-11-21', [{ ...t[t.length - 17], id: 'y', date: '2026-11-20', time: new Date(2026, 10, 20, 23, 0).getTime() }])
    const full = withCarry(t, carry)
    const legs = computeLegs(full, dayStays(full))
    expect(legs.filter((l) => hhmm(l.start) < '09:00')).toHaveLength(2)
  })
})
