import { describe, expect, it } from 'vitest'
import type { RoutePoint } from './day'
import { entryEditLine, nextAnchor, routeWithEntryEdits } from './entryRoute'

const pt = (id: string, type: 'entry' | 'track', lat: number, time: number): RoutePoint => ({ lat, lng: 121, time, ref: { type, id } })

describe('從記帳點手繪路線', () => {
  // e1（紀錄）→ a1、a2（背景定位停著飄移）→ m1（手動定位）→ e2（紀錄）
  const route = [pt('e1', 'entry', 25, 1), pt('a1', 'track', 25.0001, 2), pt('a2', 'track', 25.0002, 3), pt('m1', 'track', 25.01, 4), pt('e2', 'entry', 25.02, 5)]
  const isAnchor = (p: RoutePoint) => p.ref.type === 'entry' || p.ref.id === 'm1'

  it('下一個地點跳過背景定位的點', () => {
    expect(nextAnchor(route, 'e1', isAnchor)?.ref.id).toBe('m1')
    expect(nextAnchor(route, 'm1', isAnchor)).toBeNull()
    expect(nextAnchor(route, 'e2', isAnchor)).toBeNull()
  })

  it('畫的線取代紀錄到下一個地點那段，頭尾都在線上', () => {
    const drawn = [
      { lat: 25.003, lng: 121.002 },
      { lat: 25.008, lng: 121.001 },
    ]
    const line = routeWithEntryEdits(route, { e1: drawn }, isAnchor)
    expect(line.map((p) => p.lat)).toEqual([25, 25.003, 25.008, 25.01, 25.02])
  })

  it('最後一個地點畫的線照畫的停住；沒畫就照原本連', () => {
    const line = routeWithEntryEdits(route, { e2: [{ lat: 25.03, lng: 121 }] }, isAnchor)
    expect(line.map((p) => p.lat)).toEqual([25, 25.0001, 25.0002, 25.01, 25.02, 25.03])
    expect(routeWithEntryEdits(route, {}, isAnchor)).toHaveLength(5)
  })

  it('有背景定位移動時另外畫一條，從紀錄開始、重複的點去掉', () => {
    const e = { lat: 25, lng: 121 }
    expect(entryEditLine(e, [e, { lat: 25.1, lng: 121 }], null)).toEqual([e, { lat: 25.1, lng: 121 }])
  })
})
