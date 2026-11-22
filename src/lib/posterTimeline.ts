import type { PosterDay, PosterInput } from './poster'

/** 影片的時間軸（不碰畫布、不碰資料庫，方便測試） */

export interface FrameState {
  /** 畫到第幾天（可以有小數：2.5＝第 3 天畫一半） */
  progress: number
  /** 標題的透明度（開場淡入） */
  titleAlpha: number
  /** 地名（影片最後才出現） */
  names: boolean
  numbers: { km: number; places: number; photos: number; expense: number; steps: number }
  /** 左上角的「Day 2 · 花蓮」 */
  chip: { text: string; color: string } | null
  /** 正在彈出的照片（plan.photos 的第幾張）；phase 0→1：彈出、停留、縮回 */
  photo: { index: number; phase: number } | null
  /** 已經播過的照片（plan.photos 的第幾張），在地圖上留小圓圖 */
  shown: number[]
}

/** 開場、結尾定格的秒數 */
export const INTRO = 1.5
export const OUTRO = 3
/** 自動判斷：每張照片停多久、每天畫路線多久、最長幾秒 */
export const AUTO_PHOTO_SEC = 1.2
export const AUTO_DAY_SEC = 1.5
export const AUTO_MAX_SEC = 600
export const AUTO_MIN_SEC = 10
/** 固定長度時：照片最多占畫路線時間的幾成、每張至少／最多停幾秒 */
const FIXED_PHOTO_SHARE = 0.6
const FIXED_PHOTO_MIN = 1
const FIXED_PHOTO_MAX = 1.5

export interface VideoPlan {
  duration: number
  /** 要放進影片的照片：原本清單的第幾張、第幾天（照時間排好） */
  photos: { src: number; day: number }[]
  photoSec: number
  /** 每天畫路線的秒數（不含照片） */
  daySec: number
}

/** 從 n 個裡平均挑 k 個（留頭尾） */
export function pickEvenly(n: number, k: number): number[] {
  if (k >= n) return Array.from({ length: n }, (_, i) => i)
  if (k <= 0) return []
  if (k === 1) return [0]
  return Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / (k - 1)))
}

/**
 * 決定影片長度與要放的照片。
 * photoDays：每張照片是第幾天（照時間排好）。length＝'auto' 時依照片張數決定長度（最長 600 秒）。
 */
export function planVideo(nDays: number, photoDays: number[], length: number | 'auto'): VideoPlan {
  const days = Math.max(1, nDays)
  if (length === 'auto') {
    const fixed = INTRO + OUTRO + days * AUTO_DAY_SEC
    const room = Math.max(0, Math.floor((AUTO_MAX_SEC - fixed) / AUTO_PHOTO_SEC))
    const idx = pickEvenly(photoDays.length, room)
    const raw = fixed + idx.length * AUTO_PHOTO_SEC
    const duration = Math.min(AUTO_MAX_SEC, Math.max(AUTO_MIN_SEC, raw))
    // 太短時拉長畫路線的時間補到 10 秒
    const daySec = (duration - INTRO - OUTRO - idx.length * AUTO_PHOTO_SEC) / days
    return { duration, photos: idx.map((i) => ({ src: i, day: photoDays[i] })), photoSec: AUTO_PHOTO_SEC, daySec }
  }
  const avail = Math.max(1, length - INTRO - OUTRO)
  const budget = photoDays.length ? avail * FIXED_PHOTO_SHARE : 0
  const idx = pickEvenly(photoDays.length, Math.floor(budget / FIXED_PHOTO_MIN))
  const photoSec = idx.length ? Math.min(FIXED_PHOTO_MAX, budget / idx.length) : 0
  return {
    duration: length,
    photos: idx.map((i) => ({ src: i, day: photoDays[i] })),
    photoSec,
    daySec: (avail - idx.length * photoSec) / days,
  }
}

type Seg = { t0: number; t1: number } & ({ kind: 'draw'; day: number; f0: number; f1: number } | { kind: 'photo'; day: number; index: number })

/** 把計畫排成一段一段：每天的路線依那天的照片張數切成幾份，每份畫完彈出一張照片 */
function schedule(nDays: number, plan: VideoPlan): Seg[] {
  const segs: Seg[] = []
  let t = INTRO
  for (let d = 0; d < nDays; d++) {
    const mine = plan.photos.map((p, i) => ({ ...p, i })).filter((p) => p.day === d)
    const piece = plan.daySec / (mine.length + 1)
    for (let k = 0; k <= mine.length; k++) {
      segs.push({ kind: 'draw', day: d, f0: k / (mine.length + 1), f1: (k + 1) / (mine.length + 1), t0: t, t1: t + piece })
      t += piece
      if (k < mine.length) {
        segs.push({ kind: 'photo', day: d, index: mine[k].i, t0: t, t1: t + plan.photoSec })
        t += plan.photoSec
      }
    }
  }
  return segs
}

const cache = new WeakMap<VideoPlan, Seg[]>()

/** 影片第 t 秒的畫面（第三個參數給秒數＝沒有照片、平均畫完每天） */
export function videoFrameAt(p: { input: PosterInput; days: { day: PosterDay }[] }, t: number, planOrDuration: VideoPlan | number): FrameState {
  const { input } = p
  const n = p.days.length
  const plan: VideoPlan =
    typeof planOrDuration === 'number'
      ? { duration: planOrDuration, photos: [], photoSec: 0, daySec: (planOrDuration - INTRO - OUTRO) / Math.max(1, n) }
      : planOrDuration
  let segs = cache.get(plan)
  if (!segs) {
    segs = schedule(n, plan)
    cache.set(plan, segs)
  }
  const drawEnd = plan.duration - OUTRO
  const done = t >= drawEnd
  let progress = t <= INTRO ? 0 : n
  let photo: FrameState['photo'] = null
  const shown: number[] = []
  if (!done && t > INTRO) {
    for (const s of segs) {
      if (t >= s.t1) {
        if (s.kind === 'photo') shown.push(s.index)
        continue
      }
      if (s.kind === 'draw') progress = s.day + s.f0 + ((t - s.t0) / (s.t1 - s.t0)) * (s.f1 - s.f0)
      else {
        progress = s.day + segs.filter((x) => x.kind === 'draw' && x.day === s.day && x.t1 <= s.t0).reduce((m, x) => Math.max(m, (x as { f1: number }).f1), 0)
        photo = { index: s.index, phase: (t - s.t0) / (s.t1 - s.t0) }
      }
      break
    }
  } else if (done) {
    plan.photos.forEach((_, i) => shown.push(i))
  }
  if (n === 0) progress = 0
  // 數字跟著畫到的天數往上加
  const whole = Math.floor(progress)
  const frac = progress - whole
  const sum = (key: 'km' | 'photos' | 'expense' | 'steps') => {
    let v = 0
    p.days.forEach((d, i) => {
      const x = d.day[key] ?? 0
      if (i < whole) v += x
      else if (i === whole) v += x * frac
    })
    return v
  }
  const numbers = done
    ? input.stats
    : {
        km: Math.round(sum('km')),
        places: n ? (input.stats.places * progress) / n : 0,
        photos: sum('photos'),
        expense: sum('expense'),
        steps: sum('steps'),
      }
  const current = p.days[Math.min(n - 1, whole)]?.day
  return {
    progress,
    titleAlpha: Math.min(1, t / 0.8),
    names: done && input.showNames,
    numbers,
    chip: !done && progress > 0 && current?.label ? { text: current.label, color: current.color } : null,
    photo,
    shown,
  }
}

/** 預估影片檔案大小（位元組）：照片多的影片畫面變化多，比較大 */
export function estimateVideoBytes(plan: VideoPlan, bitsPerSec: number): number {
  const photoTime = plan.photos.length * plan.photoSec
  const still = plan.duration - photoTime
  // 地圖幾乎不動的部分約 0.6 Mbps；照片彈出、換張的部分約用到上限的一半
  return Math.round((still * 600_000 + photoTime * bitsPerSec * 0.5) / 8)
}

/** 影片的位元率：長影片降一點，檔案不會太大 */
export function videoBitrate(duration: number): number {
  return duration > 60 ? 4_000_000 : 8_000_000
}
