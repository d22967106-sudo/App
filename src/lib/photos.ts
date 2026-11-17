import { newId } from './db'
import type { Photo } from './types'

export const THUMB_EDGE = 400
export const DISPLAY_EDGE = 2048
const QUALITY = 0.8

/**
 * 從 JPEG 的 EXIF 讀出拍攝時間（DateTimeOriginal），讀不到回傳 null。
 * 只解析需要的部分，不依賴外部套件。
 */
export function readExifDate(buf: ArrayBuffer): number | null {
  const v = new DataView(buf)
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null
  let off = 2
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off)
    const size = v.getUint16(off + 2)
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966) {
      return parseTiff(v, off + 10)
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break
    off += 2 + size
  }
  return null
}

function parseTiff(v: DataView, start: number): number | null {
  try {
    const little = v.getUint16(start) === 0x4949
    const u16 = (o: number) => v.getUint16(start + o, little)
    const u32 = (o: number) => v.getUint32(start + o, little)
    const readTag = (ifd: number, tag: number): number | null => {
      const n = u16(ifd)
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12
        if (u16(e) === tag) return e
      }
      return null
    }
    const ifd0 = u32(4)
    const exifPtr = readTag(ifd0, 0x8769)
    const findDate = (ifd: number, tag: number) => {
      const e = readTag(ifd, tag)
      if (e == null) return null
      const count = u32(e + 4)
      const off = u32(e + 8)
      let s = ''
      for (let i = 0; i < count - 1; i++) s += String.fromCharCode(v.getUint8(start + off + i))
      return s
    }
    const raw = (exifPtr != null && findDate(u32(exifPtr + 8), 0x9003)) || findDate(ifd0, 0x0132)
    const m = raw && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw)
    if (!m) return null
    const [, y, mo, d, h, mi, s] = m.map(Number)
    const t = new Date(y, mo - 1, d, h, mi, s).getTime()
    return Number.isNaN(t) ? null : t
  } catch {
    return null
  }
}

export function fitSize(w: number, h: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('無法讀取這張照片'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

let webpSupported: boolean | null = null

/** 優先輸出 WebP；Safari 不支援時（拿回來不是 webp）改用 JPEG 80% */
async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  if (webpSupported !== false) {
    const b = await canvasToBlob(canvas, 'image/webp', QUALITY)
    if (b && b.type === 'image/webp') {
      webpSupported = true
      return b
    }
    webpSupported = false
  }
  const j = await canvasToBlob(canvas, 'image/jpeg', QUALITY)
  if (!j) throw new Error('照片壓縮失敗')
  return j
}

async function resize(img: HTMLImageElement, edge: number): Promise<Blob> {
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, edge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('照片壓縮失敗')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await encode(canvas)
  canvas.width = canvas.height = 0 // 釋放 iOS 的畫布記憶體
  return blob
}

/** 把選到的照片壓成縮圖（400px）與顯示版（2048px） */
export async function processPhoto(file: File, entryId: string): Promise<Photo> {
  const head = await file.slice(0, 256 * 1024).arrayBuffer()
  const takenAt = readExifDate(head) ?? (file.lastModified || null)
  const img = await loadImage(file)
  const display = await resize(img, DISPLAY_EDGE)
  const thumb = await resize(img, THUMB_EDGE)
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, DISPLAY_EDGE)
  return {
    id: newId(),
    entryId,
    thumb,
    display,
    width,
    height,
    takenAt,
    createdAt: Date.now(),
  }
}

export function photoExt(blob: Blob): string {
  return blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg'
}
