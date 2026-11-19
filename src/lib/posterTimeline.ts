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
}

/** 開場、結尾定格的秒數 */
const INTRO = 1.5
const OUTRO = 3

/** 影片第 t 秒的畫面 */
export function videoFrameAt(p: { input: PosterInput; days: { day: PosterDay }[] }, t: number, duration: number): FrameState {
  const { input } = p
  const n = p.days.length
  const drawEnd = duration - OUTRO
  const progress = n === 0 ? 0 : Math.max(0, Math.min(n, ((t - INTRO) / (drawEnd - INTRO)) * n))
  const done = t >= drawEnd
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
  }
}

