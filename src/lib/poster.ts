import { Map as MlMap, setWorkerUrl } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { MAP_STYLES, type VectorStyle } from './mapStyles'
import type { GeoPoint } from './types'
import type { StyleSpec } from './vectorStyle'
import { videoFrameAt, type FrameState } from './posterTimeline'

export { videoFrameAt }

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
  /** 影片用：畫到這天時左上角顯示的字，例如「Day 2 · 花蓮」 */
  label?: string
  /** 影片用：這天的數字（畫到這天時往上加） */
  km?: number
  photos?: number
  expense?: number
  steps?: number
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

const basemapOrder = (b: PosterBasemap): PosterBasemap[] => (b === 'tea' ? ['tea', 'osm', 'none'] : b === 'osm' ? ['osm', 'none'] : ['none'])

/** 依序試底圖（奶茶淡色 → 淡色地圖 → 只有路線），回傳準備好的畫布 */
async function prepareWithFallback(input: PosterInput): Promise<Prepared> {
  let lastError: unknown
  for (const basemap of basemapOrder(input.basemap)) {
    try {
      const p = await prepare({ ...input, basemap })
      // 圖磚伺服器不允許跨網域讀取時，canvas 會被「汙染」不能輸出：先試一次
      p.base.getContext('2d')!.getImageData(0, 0, 1, 1)
      return p
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}

/** 畫好的圖；used＝實際用的底圖（載入失敗會依序退到 osm、none） */
export async function renderPoster(input: PosterInput): Promise<{ blob: Blob; used: PosterBasemap }> {
  const p = await prepareWithFallback(input)
  drawFrame(p, finalFrame(p))
  const blob = await new Promise<Blob>((resolve, reject) => {
    try {
      p.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('無法產生圖片'))), 'image/png')
    } catch (e) {
      reject(e)
    }
  })
  return { blob, used: p.input.basemap }
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

// ── 準備：底圖畫一次，路線位置先算好 ──

interface ProjectedDay {
  day: PosterDay
  pts: [number, number][]
  /** 每一點累積的長度（畫一部分路線用） */
  cum: number[]
}

interface Prepared {
  input: PosterInput
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  titleSize: number
  titleBase: number
  mx: number
  my: number
  mw: number
  mh: number
  /** 地圖區塊的底（底圖或空白），每一格都先貼上它 */
  base: HTMLCanvasElement
  days: ProjectedDay[]
  start: [number, number] | null
  project: (p: GeoPoint) => [number, number]
}

async function prepare(input: PosterInput): Promise<Prepared> {
  await document.fonts?.ready
  const { w, h } = posterSize(input.ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  let titleSize = 115
  ctx.font = `700 ${titleSize}px ${FONT}`
  while (ctx.measureText(input.name).width > w - PAD * 2 - 300 && titleSize > 56) {
    titleSize -= 4
    ctx.font = `700 ${titleSize}px ${FONT}`
  }
  const titleBase = PAD + 100
  const mx = PAD
  const my = titleBase + 44
  const mw = w - PAD * 2
  const mh = h - my - 250 - PAD

  const base = document.createElement('canvas')
  base.width = Math.round(mw)
  base.height = Math.round(mh)
  const bctx = base.getContext('2d')!
  bctx.fillStyle = MAP_BG
  bctx.fillRect(0, 0, mw, mh)

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
      bctx.drawImage(img, 0, 0, mw, mh)
    } else if (input.basemap === 'osm') {
      const tz = Math.min(18, Math.ceil(z))
      const size = TILE * 2 ** (z - tz)
      const left = cx - mw / 2
      const top = cy - mh / 2
      const jobs: Promise<void>[] = []
      let loaded = 0
      for (let tx = Math.floor(left / size); tx <= Math.floor((left + mw) / size); tx++) {
        for (let ty = Math.floor(top / size); ty <= Math.floor((top + mh) / size); ty++) {
          jobs.push(
            loadTile(tz, tx, ty).then((img) => {
              if (!img) return
              bctx.drawImage(img, tx * size - left, ty * size - top, size + 0.5, size + 0.5)
              loaded++
            }),
          )
        }
      }
      await Promise.all(jobs)
      if (!loaded) throw new Error('地圖圖磚都載入失敗')
      // 奶茶色：先乘上米色，再蓋一層淡淡的底色
      bctx.globalCompositeOperation = 'multiply'
      bctx.fillStyle = '#F1E2CF'
      bctx.fillRect(0, 0, mw, mh)
      bctx.globalCompositeOperation = 'source-over'
      bctx.fillStyle = 'rgba(251, 246, 239, 0.45)'
      bctx.fillRect(0, 0, mw, mh)
    }
  }
  if (input.basemap !== 'none' && input.showCredit) {
    // 小而淡，但還讀得出來
    bctx.font = `400 15px ${FONT}`
    bctx.textAlign = 'right'
    bctx.fillStyle = 'rgba(125, 100, 80, 0.75)'
    bctx.fillText(input.basemap === 'tea' ? 'OpenFreeMap © OpenMapTiles © OpenStreetMap' : '© OpenStreetMap', mw - 14, mh - 12)
  }

  const days = input.days.map((day) => {
    const pts = day.route.map(project)
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    return { day, pts, cum }
  })
  return { input, canvas, ctx, w, h, titleSize, titleBase, mx, my, mw, mh, base, days, start: all.length ? project(all[0]) : null, project }
}

// ── 畫一格 ──

function finalFrame(p: Prepared): FrameState {
  return { progress: p.days.length, titleAlpha: 1, names: p.input.showNames, numbers: p.input.stats, chip: null }
}

/** 顏色太淺時字用深色 */
function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? TEXT : '#FFFFFF'
}

function strokeRoute(ctx: CanvasRenderingContext2D, d: ProjectedDay, upto: number) {
  // upto：畫到這條路線長度的幾分之幾
  const total = d.cum[d.cum.length - 1]
  const limit = total * upto
  ctx.beginPath()
  ctx.moveTo(d.pts[0][0], d.pts[0][1])
  for (let i = 1; i < d.pts.length; i++) {
    if (d.cum[i] <= limit) ctx.lineTo(d.pts[i][0], d.pts[i][1])
    else {
      const seg = d.cum[i] - d.cum[i - 1]
      const k = seg ? (limit - d.cum[i - 1]) / seg : 0
      ctx.lineTo(d.pts[i - 1][0] + (d.pts[i][0] - d.pts[i - 1][0]) * k, d.pts[i - 1][1] + (d.pts[i][1] - d.pts[i - 1][1]) * k)
      break
    }
  }
}

function drawFrame(p: Prepared, f: FrameState) {
  const { ctx, input, w, h, mx, my, mw, mh, titleBase } = p
  ctx.save()
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, w, h)

  // ── 標題與日期 ──
  ctx.globalAlpha = f.titleAlpha
  ctx.fillStyle = TEXT
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${p.titleSize}px ${FONT}`
  ctx.fillText(input.name, PAD, titleBase)
  ctx.textAlign = 'right'
  ctx.fillStyle = TEXT_2
  ctx.font = `400 25px ${FONT}`
  ctx.fillText(formatRange(input.start, input.end), w - PAD, titleBase - 34)
  ctx.fillText(`${input.days.length} DAY${input.days.length > 1 ? 'S' : ''}`, w - PAD, titleBase)
  ctx.textAlign = 'left'
  ctx.globalAlpha = 1

  // ── 地圖 ──
  ctx.save()
  roundRect(ctx, mx, my, mw, mh, 28)
  ctx.clip()
  ctx.drawImage(p.base, mx, my, mw, mh)

  if (p.start) {
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const pass of ['casing', 'line'] as const) {
      p.days.forEach((d, i) => {
        const upto = Math.max(0, Math.min(1, f.progress - i))
        if (upto <= 0 || d.pts.length < 2) return
        strokeRoute(ctx, d, upto)
        ctx.strokeStyle = pass === 'casing' ? (input.basemap !== 'none' ? '#FFFFFF' : BG) : d.day.color
        ctx.lineWidth = pass === 'casing' ? 14 : 7
        ctx.setLineDash(pass === 'line' && d.day.dashed ? [16, 14] : [])
        ctx.stroke()
        ctx.setLineDash([])
      })
    }

    // 起點
    ctx.beginPath()
    ctx.arc(p.start[0], p.start[1], 13, 0, Math.PI * 2)
    ctx.fillStyle = TEXT
    ctx.fill()

    // 地名
    if (f.names) {
      ctx.font = `400 24px ${FONT}`
      const placed: [number, number][] = [p.start]
      const names = new Set<string>()
      for (const { day: d } of p.days) {
        const lm = d.landmark
        if (!lm || names.has(lm.name)) continue
        const [x, y] = p.project(lm)
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

    // 影片：左上角「Day 2 · 花蓮」
    if (f.chip) {
      ctx.font = `700 30px ${FONT}`
      const tw = ctx.measureText(f.chip.text).width
      ctx.fillStyle = f.chip.color
      roundRect(ctx, mx + 24, my + 24, tw + 44, 54, 27)
      ctx.fill()
      ctx.fillStyle = textOn(f.chip.color)
      ctx.fillText(f.chip.text, mx + 46, my + 62)
    }
  } else {
    ctx.fillStyle = TEXT_2
    ctx.font = `400 28px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('這段期間沒有軌跡', mx + mw / 2, my + mh / 2)
    ctx.textAlign = 'left'
  }
  ctx.restore()

  // ── 每天的顏色 ──
  const ly = my + mh + 56
  ctx.font = `400 23px ${FONT}`
  const shown = input.days.slice(0, 7)
  const slot = mw / Math.max(shown.length, 1)
  shown.forEach((d, i) => {
    const x = mx + slot * i
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
  const n = f.numbers
  const items: [string, string][] = [
    [fmt(n.km), '公里'],
    [fmt(Math.round(n.places)), '個地點'],
    [fmt(Math.round(n.photos)), '張照片'],
    input.showMoney ? [fmt(Math.round(n.expense)), '新台幣'] : [fmt(Math.round(n.steps)), '步'],
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
  ctx.restore()
}

// ── 影片 ──

export interface VideoResult {
  blob: Blob
  /** 副檔名 mp4 或 webm */
  ext: string
  used: PosterBasemap
}

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m
  }
  return null
}

/** 這支手機能不能錄影 */
export function canRecordVideo(): boolean {
  return !!pickMime() && typeof HTMLCanvasElement.prototype.captureStream === 'function'
}

/**
 * 錄影片：準備好畫布後交給 onCanvas 放到畫面上（邊錄邊看；錄的時候畫布要在畫面上），
 * 用 requestAnimationFrame 一格一格畫，MediaRecorder 錄下 canvas 的畫面。
 */
export async function recordVideo(
  input: PosterInput,
  duration: number,
  hooks: { onCanvas: (c: HTMLCanvasElement) => void; onProgress: (sec: number) => void; signal?: AbortSignal },
): Promise<VideoResult> {
  const mime = pickMime()
  if (!mime || typeof HTMLCanvasElement.prototype.captureStream !== 'function') throw new Error('這支手機的瀏覽器不支援錄影')
  const p = await prepareWithFallback(input)
  drawFrame(p, videoFrameAt(p, 0, duration))
  hooks.onCanvas(p.canvas)
  const stream = p.canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()))
  recorder.start(500)
  await new Promise<void>((resolve, reject) => {
    const t0 = performance.now()
    let last = -1
    const tick = () => {
      if (hooks.signal?.aborted) return reject(new DOMException('已取消', 'AbortError'))
      const t = (performance.now() - t0) / 1000
      drawFrame(p, videoFrameAt(p, Math.min(t, duration), duration))
      const sec = Math.floor(t)
      if (sec !== last) {
        last = sec
        hooks.onProgress(Math.min(sec, duration))
      }
      if (t >= duration) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }).finally(() => {
    if (recorder.state !== 'inactive') recorder.stop()
    stream.getTracks().forEach((tr) => tr.stop())
  })
  await stopped
  const type = mime.split(';')[0]
  return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm', used: p.input.basemap }
}
