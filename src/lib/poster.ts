import { Map as MlMap, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MAP_STYLES, type VectorStyle } from './mapStyles'
import type { GeoPoint } from './types'
import type { StyleSpec } from './vectorStyle'

setWorkerUrl(maplibreWorkerUrl)

/**
 * 旅遊軌跡圖：用 canvas 畫出一張圖片（1080 寬，4:5 或 9:16）。
 * 版面照預覽圖「6 旅遊軌跡圖（簡潔版）」；底圖：
 *   tea＝奶茶淡色地圖（跟地圖首頁預設一樣的 OpenFreeMap 向量地圖，用 MapLibre 在畫面外畫好再貼上）
 *   osm＝淡色地圖（OSM 圖磚＋奶茶色蓋一層）
 *   none＝只有路線（前兩種都失敗時才會用到）
 */

export type PosterRatio = '4:5' | '9:16'
export type PosterBasemap = 'tea' | 'osm' | 'none'

export interface PosterDay {
  color: string
  dashed?: boolean
  route: GeoPoint[]
  landmark: (GeoPoint & { name: string }) | null
}

export interface PosterInput {
  name: string
  start: string
  end: string
  days: PosterDay[]
  stats: { km: number; places: number; photos: number; expense: number; steps: number }
  ratio: PosterRatio
  basemap: PosterBasemap
  showMoney: boolean
  showNames: boolean
  /** 地圖出處（OSM 授權要求公開分享時標示；只自己看可以關掉） */
  showCredit: boolean
}

const W = 1080
const PAD = 86
const BG = '#FBF6EF'
const MAP_BG = '#F1E6D8'
const TEXT = '#3A2618'
const TEXT_2 = '#7D6450'
const TEXT_BODY = '#4A3526'
const LINE = '#E5D3BF'
const FONT = "'Noto Sans TC', 'PingFang TC', -apple-system, system-ui, sans-serif"

const TILE = 256
const TILE_URL = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`

function worldPx(p: GeoPoint, z: number): [number, number] {
  const scale = TILE * 2 ** z
  const x = ((p.lng + 180) / 360) * scale
  const s = Math.sin((p.lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
  return [x, y]
}

export function posterSize(ratio: PosterRatio): { w: number; h: number } {
  return { w: W, h: ratio === '9:16' ? 1920 : 1350 }
}

function formatRange(start: string, end: string): string {
  const s = start.replace(/-/g, '.')
  if (start === end) return s
  const e = end.slice(0, 4) === start.slice(0, 4) ? end.slice(5).replace('-', '.') : end.replace(/-/g, '.')
  return `${s} — ${e}`
}

function loadTile(z: number, x: number, y: number): Promise<HTMLImageElement | null> {
  const n = 2 ** z
  const wx = ((x % n) + n) % n
  if (y < 0 || y >= n) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = setTimeout(() => resolve(null), 10000)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(null)
    }
    img.src = TILE_URL(z, wx, y)
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fmt(n: number): string {
  return n.toLocaleString('zh-TW', { maximumFractionDigits: n < 10 ? 1 : 0 })
}

/** 畫好的圖；used＝實際用的底圖（載入失敗會依序退到 osm、none） */
export async function renderPoster(input: PosterInput): Promise<{ blob: Blob; used: PosterBasemap }> {
  const order: PosterBasemap[] = input.basemap === 'tea' ? ['tea', 'osm', 'none'] : input.basemap === 'osm' ? ['osm', 'none'] : ['none']
  let lastError: unknown
  for (const basemap of order) {
    try {
      return { blob: await draw({ ...input, basemap }), used: basemap }
    } catch (e) {
      // 地圖載入失敗，或圖磚伺服器不允許跨網域讀取（canvas 被汙染不能輸出）→ 換下一種
      lastError = e
    }
  }
  throw lastError
}

/** 用 MapLibre 在畫面外畫一張奶茶淡色地圖（center、zoom 用 256 px 圖磚的算法） */
async function drawTeaMap(center: GeoPoint, z: number, w: number, h: number): Promise<HTMLCanvasElement> {
  const st = MAP_STYLES.find((m) => m.id === 'warm') as VectorStyle
  const res = await fetch(st.styleUrl)
  if (!res.ok) throw new Error(`style ${res.status}`)
  const spec = st.transform((await res.json()) as StyleSpec)
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;opacity:0;pointer-events:none;z-index:-1`
  document.body.appendChild(el)
  const map = new MlMap({
    container: el,
    style: spec as never,
    center: [center.lng, center.lat],
    // MapLibre 的圖磚是 512 px，所以縮放等級少 1
    zoom: z - 1,
    interactive: false,
    attributionControl: false,
    pixelRatio: 1,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    localIdeographFontFamily: "'PingFang TC', 'Noto Sans TC', sans-serif",
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('地圖載入逾時')), 20000)
      map.once('idle', () => {
        clearTimeout(timer)
        resolve()
      })
      map.on('error', (e) => {
        // 個別圖磚失敗不算，樣式本身失敗才放棄
        if (!(e as { tile?: unknown }).tile && !map.loaded()) {
          clearTimeout(timer)
          reject(e.error ?? new Error('地圖載入失敗'))
        }
      })
    })
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d')!.drawImage(map.getCanvas(), 0, 0, w, h)
    return out
  } finally {
    map.remove()
    el.remove()
  }
}

function unproject(x: number, y: number, z: number): GeoPoint {
  const scale = TILE * 2 ** z
  const lng = (x / scale) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / scale
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng }
}

async function draw(input: PosterInput): Promise<Blob> {
  await document.fonts?.ready
  const { w, h } = posterSize(input.ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, w, h)

  // ── 標題與日期 ──
  ctx.fillStyle = TEXT
  ctx.textBaseline = 'alphabetic'
  let titleSize = 115
  ctx.font = `700 ${titleSize}px ${FONT}`
  while (ctx.measureText(input.name).width > w - PAD * 2 - 300 && titleSize > 56) {
    titleSize -= 4
    ctx.font = `700 ${titleSize}px ${FONT}`
  }
  const titleBase = PAD + 100
  ctx.fillText(input.name, PAD, titleBase)
  ctx.textAlign = 'right'
  ctx.fillStyle = TEXT_2
  ctx.font = `400 25px ${FONT}`
  ctx.fillText(formatRange(input.start, input.end), w - PAD, titleBase - 34)
  ctx.fillText(`${input.days.length} DAY${input.days.length > 1 ? 'S' : ''}`, w - PAD, titleBase)
  ctx.textAlign = 'left'

  // ── 地圖 ──
  const mx = PAD
  const my = titleBase + 44
  const mw = w - PAD * 2
  const mh = h - my - 250 - PAD
  ctx.save()
  roundRect(ctx, mx, my, mw, mh, 28)
  ctx.fillStyle = MAP_BG
  ctx.fill()
  ctx.clip()

  const all = input.days.flatMap((d) => d.route)
  let project: (p: GeoPoint) => [number, number] = () => [mx + mw / 2, my + mh / 2]
  if (all.length) {
    const inner = 70
    let z = 17
    for (; z > 1; z -= 0.25) {
      const xs = all.map((p) => worldPx(p, z)[0])
      const ys = all.map((p) => worldPx(p, z)[1])
      if (Math.max(...xs) - Math.min(...xs) <= mw - inner * 2 && Math.max(...ys) - Math.min(...ys) <= mh - inner * 2) break
    }
    const pxs = all.map((p) => worldPx(p, z))
    const cx = (Math.min(...pxs.map((p) => p[0])) + Math.max(...pxs.map((p) => p[0]))) / 2
    const cy = (Math.min(...pxs.map((p) => p[1])) + Math.max(...pxs.map((p) => p[1]))) / 2
    const ox = mx + mw / 2 - cx
    const oy = my + mh / 2 - cy
    project = (p) => {
      const [x, y] = worldPx(p, z)
      return [x + ox, y + oy]
    }

    if (input.basemap === 'tea') {
      const img = await drawTeaMap(unproject(cx, cy, z), z, Math.round(mw), Math.round(mh))
      ctx.drawImage(img, mx, my, mw, mh)
    } else if (input.basemap === 'osm') {
      const tz = Math.min(18, Math.ceil(z))
      const k = 2 ** (z - tz)
      const size = TILE * k
      const left = cx - mw / 2
      const top = cy - mh / 2
      const x0 = Math.floor(left / size)
      const y0 = Math.floor(top / size)
      const x1 = Math.floor((left + mw) / size)
      const y1 = Math.floor((top + mh) / size)
      const jobs: Promise<void>[] = []
      let loaded = 0
      for (let tx = x0; tx <= x1; tx++) {
        for (let ty = y0; ty <= y1; ty++) {
          jobs.push(
            loadTile(tz, tx, ty).then((img) => {
              if (!img) return
              ctx.drawImage(img, tx * size + ox, ty * size + oy, size + 0.5, size + 0.5)
              loaded++
            }),
          )
        }
      }
      await Promise.all(jobs)
      if (!loaded) throw new Error('地圖圖磚都載入失敗')
      // 奶茶色：先乘上米色，再蓋一層淡淡的底色
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = '#F1E2CF'
      ctx.fillRect(mx, my, mw, mh)
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(251, 246, 239, 0.45)'
      ctx.fillRect(mx, my, mw, mh)
    }

    // 路線：先畫白邊再畫顏色
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const pass of ['casing', 'line'] as const) {
      for (const d of input.days) {
        if (d.route.length < 2) continue
        ctx.beginPath()
        d.route.forEach((p, i) => {
          const [x, y] = project(p)
          if (i) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
        })
        ctx.strokeStyle = pass === 'casing' ? (input.basemap !== 'none' ? '#FFFFFF' : BG) : d.color
        ctx.lineWidth = pass === 'casing' ? 14 : 7
        ctx.setLineDash(pass === 'line' && d.dashed ? [16, 14] : [])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }

    // 起點
    const [sx, sy] = project(all[0])
    ctx.beginPath()
    ctx.arc(sx, sy, 13, 0, Math.PI * 2)
    ctx.fillStyle = TEXT
    ctx.fill()

    // 地名
    if (input.showNames) {
      ctx.font = `400 24px ${FONT}`
      const placed: [number, number][] = [[sx, sy]]
      const names = new Set<string>()
      for (const d of input.days) {
        const lm = d.landmark
        if (!lm || names.has(lm.name)) continue
        const [x, y] = project(lm)
        if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 70)) continue
        placed.push([x, y])
        names.add(lm.name)
        ctx.beginPath()
        ctx.arc(x, y, 9, 0, Math.PI * 2)
        ctx.fillStyle = BG
        ctx.fill()
        ctx.lineWidth = 5
        ctx.strokeStyle = d.color
        ctx.stroke()
        const tw = ctx.measureText(lm.name).width
        const right = x + 18 + tw < mx + mw - 12
        ctx.textAlign = right ? 'left' : 'right'
        ctx.lineWidth = 6
        ctx.strokeStyle = input.basemap !== 'none' ? 'rgba(255,255,255,0.85)' : MAP_BG
        const lx = right ? x + 18 : x - 18
        ctx.strokeText(lm.name, lx, y - 10)
        ctx.fillStyle = TEXT_BODY
        ctx.fillText(lm.name, lx, y - 10)
        ctx.textAlign = 'left'
      }
    }
  } else {
    ctx.fillStyle = TEXT_2
    ctx.font = `400 28px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('這段期間沒有軌跡', mx + mw / 2, my + mh / 2)
    ctx.textAlign = 'left'
  }
  if (input.basemap !== 'none' && input.showCredit) {
    // 小而淡，但還讀得出來
    ctx.font = `400 15px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(125, 100, 80, 0.75)'
    ctx.fillText(input.basemap === 'tea' ? 'OpenFreeMap © OpenMapTiles © OpenStreetMap' : '© OpenStreetMap', mx + mw - 14, my + mh - 12)
    ctx.textAlign = 'left'
  }
  ctx.restore()

  // ── 每天的顏色 ──
  const ly = my + mh + 56
  ctx.font = `400 23px ${FONT}`
  const shown = input.days.slice(0, 7)
  const slot = mw / Math.max(shown.length, 1)
  shown.forEach((d, i) => {
    const x = mx + slot * i + (shown.length === 1 ? 0 : 0)
    if (d.dashed) {
      ctx.strokeStyle = d.color
      ctx.lineWidth = 7
      ctx.lineCap = 'butt'
      ctx.setLineDash([9, 6])
      ctx.beginPath()
      ctx.moveTo(x, ly - 7.5)
      ctx.lineTo(x + 32, ly - 7.5)
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.fillStyle = d.color
      roundRect(ctx, x, ly - 11, 32, 7, 3.5)
      ctx.fill()
    }
    ctx.fillStyle = TEXT_BODY
    ctx.fillText(i === 6 && input.days.length > 7 ? `Day 7…${input.days.length}` : `Day ${i + 1}`, x + 42, ly - 1)
  })

  // ── 分隔線與數字 ──
  const dy = ly + 40
  ctx.fillStyle = LINE
  ctx.fillRect(mx, dy, mw, 2)
  const items: [string, string][] = [
    [fmt(input.stats.km), '公里'],
    [fmt(input.stats.places), '個地點'],
    [fmt(input.stats.photos), '張照片'],
    input.showMoney ? [fmt(Math.round(input.stats.expense)), '新台幣'] : [fmt(input.stats.steps), '步'],
  ]
  const col = mw / 4
  items.forEach(([num, label], i) => {
    const x = mx + col * i
    ctx.fillStyle = TEXT
    ctx.font = `700 47px ${FONT}`
    ctx.fillText(num, x, dy + 86)
    ctx.fillStyle = TEXT_2
    ctx.font = `400 22px ${FONT}`
    ctx.fillText(label, x, dy + 124)
  })

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('無法產生圖片'))), 'image/png')
    } catch (e) {
      reject(e)
    }
  })
}
