/**
 * 解析從 Google 地圖／Apple 地圖「分享 → 複製」貼上的文字：
 *   幸福早午餐
 *   600嘉義市東區中山路123號
 *   https://maps.app.goo.gl/xxxx
 * 取出店名、地址；網址裡有座標就一併取出（短網址讀不到內容，只能靠文字）。
 */

import { TW_COUNTIES } from './areaQuery'

export interface SharedPlace {
  name?: string
  address?: string
  lat?: number
  lng?: number
}

const MAP_URL = /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com)\S*/gi

/** 看起來像地址的一行：有門牌號、或有縣市＋路街 */
export function looksLikeAddress(s: string): boolean {
  return /\d+(之\d+)?號/.test(s) || /^\d{3,6}/.test(s) || /(市|縣|區|鄉|鎮).*(路|街|大道|段|巷)/.test(s) || /\d+.*(St|Rd|Ave|Street|Road)\b/i.test(s)
}

function coordsFromUrl(url: string): { lat: number; lng: number } | null {
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|ll|query|sll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/]
  for (const p of pats) {
    const m = p.exec(decodeURIComponent(url))
    if (m) {
      const lat = Number(m[1])
      const lng = Number(m[2])
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
    }
  }
  return null
}

/** 縣市名（含「台」寫法），用來把黏在一起的「店名＋地址」切開 */
const COUNTY_RE = new RegExp(
  `(\\d{3,6})?(${[...TW_COUNTIES, ...TW_COUNTIES.map((c) => c.replace(/^臺/, '台'))].join('|')})`,
)

/** 「幸福早午餐600嘉義市東區中山路123號」→ 店名、地址（單行輸入框貼上時換行會被吃掉） */
export function splitNameAddress(line: string): { name?: string; address?: string } {
  const m = COUNTY_RE.exec(line)
  if (!m || m.index === 0) return looksLikeAddress(line) ? { address: line.replace(/^\d{3,6}\s*/, '') } : { name: line }
  return { name: line.slice(0, m.index).trim(), address: line.slice(m.index).replace(/^\d{3,6}\s*/, '').trim() }
}

export function parseSharedPlace(text: string): SharedPlace | null {
  const urls = text.match(MAP_URL)
  if (!urls) return null
  const out: SharedPlace = {}
  for (const u of urls) {
    const c = coordsFromUrl(u)
    if (c) {
      out.lat = c.lat
      out.lng = c.lng
      break
    }
  }
  const lines = text
    .replace(MAP_URL, '\n')
    .split(/\n|\s·\s|\s\|\s/)
    .map((l) => l.replace(/^[「『"']|[」』"']$/g, '').trim())
    .filter(Boolean)
  if (lines.length === 1) {
    const { name, address } = splitNameAddress(lines[0])
    if (name) out.name = name
    if (address) out.address = address
    return out
  }
  for (const l of lines) {
    if (!out.address && looksLikeAddress(l)) out.address = l.replace(/^\d{3,6}\s*/, '')
    else if (!out.name) out.name = l
  }
  return out
}
