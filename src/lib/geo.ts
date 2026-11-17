import type { GeoPoint } from './types'

const R = 6371008.8

/** 兩點距離（公尺） */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** 路線總長（公里），點已依時間排序 */
export function routeKm(points: GeoPoint[]): number {
  let m = 0
  for (let i = 1; i < points.length; i++) m += distanceM(points[i - 1], points[i])
  return Math.round(m / 100) / 10
}

/** 計算不同地點數：彼此距離在 radius 公尺內視為同一地點 */
export function countPlaces(points: GeoPoint[], radius = 120): number {
  const centers: GeoPoint[] = []
  for (const p of points) {
    if (!centers.some((c) => distanceM(c, p) <= radius)) centers.push(p)
  }
  return centers.length
}

export interface PositionResult extends GeoPoint {
  time: number
}

/** 取得目前位置（Promise 版），失敗時丟出中文錯誤訊息 */
export function getCurrentPosition(timeoutMs = 15000): Promise<PositionResult> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('這個瀏覽器不支援定位'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          time: pos.timestamp || Date.now(),
        }),
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? '沒有定位權限，請到「設定 › 隱私權 › 定位服務」允許 Safari 網站使用定位'
            : err.code === err.TIMEOUT
              ? '定位逾時，請稍後再試'
              : '暫時無法取得位置'
        reject(new Error(msg))
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5000 },
    )
  })
}
