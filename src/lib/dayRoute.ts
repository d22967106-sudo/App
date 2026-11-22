import { getTrackBefore, getTrackByDate } from './db'
import { applyCuts, carryPoint, computeLegs, guessMode, withCarry } from './legs'
import { getLegCuts, getLegEdits, getLegModes, getRouteSettings, snapLeg, snapLegCached } from './snap'
import { dayStays } from './day'
import type { GeoPoint } from './types'

/**
 * 某一天地圖頁上畫的路線（一段一段接起來）：跟地圖頁同樣的規則——
 * 手動切段 → 每段的交通方式（手動選的優先）→ 手繪修改的線優先，否則貼齊道路（有開的話），再不然原始的點。
 * 旅程地圖與軌跡圖／影片用（2026-11-22 使用者回報：改過的路線沒有用在影片裡）。
 * 這天沒有背景定位的移動就回傳 null（照舊用紀錄與定位點連線）。
 * offline：貼齊道路只用存過的結果、不連網（旅程列表的小縮圖用）。
 */
export async function drawnDayRoute(date: string, opts: { offline?: boolean } = {}): Promise<GeoPoint[] | null> {
  const [track, before, settings, modes, edits, cuts] = await Promise.all([
    getTrackByDate(date),
    getTrackBefore(date),
    getRouteSettings(),
    getLegModes(),
    getLegEdits(),
    getLegCuts(),
  ])
  const full = withCarry(track, carryPoint(date, before))
  const legs = applyCuts(computeLegs(full, dayStays(full)), cuts[date] ?? [])
  if (!legs.length) return null
  const out: GeoPoint[] = []
  for (const l of legs) {
    const key = `${date}/${l.id}`
    const edit = edits[key]
    let line: GeoPoint[]
    if (edit) line = edit.map(([lat, lng]) => ({ lat, lng }))
    else {
      const mode = modes[key] ?? guessMode(l, settings.mode)
      line = (settings.snap && mode !== 'none' ? await (opts.offline ? snapLegCached(l.points, mode) : snapLeg(l.points, mode)) : null) ?? l.points
    }
    for (const p of line) {
      const last = out[out.length - 1]
      if (!last || last.lat !== p.lat || last.lng !== p.lng) out.push({ lat: p.lat, lng: p.lng })
    }
  }
  return out
}
