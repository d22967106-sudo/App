import { useSyncExternalStore } from 'react'
import { getMeta, setMeta } from './db'
import { previewSvg, WARM, warmStyle, withChineseLabels, type StyleSpec } from './vectorStyle'

export type MapStyleId = 'warm' | 'liberty' | 'osm' | 'osm-warm'

interface BaseStyle {
  id: MapStyleId
  name: string
  description: string
  attribution: string
  /** 預覽小圖網址 */
  preview: string
}

export interface RasterStyle extends BaseStyle {
  kind: 'raster'
  url: string
  subdomains?: string
  /** 套在圖磚上的 CSS 濾鏡 */
  filter: string
  maxZoom: number
}

export interface VectorStyle extends BaseStyle {
  kind: 'vector'
  /** OpenFreeMap 的樣式網址 */
  styleUrl: string
  /** 下載樣式後怎麼改（重新上色、中文地名） */
  transform: (s: StyleSpec) => StyleSpec
}

export type MapStyle = RasterStyle | VectorStyle

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
const OFM_ATTR = `<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> ${OSM_ATTR}`

/** 台北車站附近一張 OSM 圖磚，當作點陣地圖的預覽 */
const OSM_PREVIEW = 'https://tile.openstreetmap.org/15/27445/14027.png'
const OSM_WARM_FILTER = 'sepia(0.35) saturate(0.75) brightness(1.02) contrast(0.92)'

/** 全部都是 OpenStreetMap 資料、免費、不用金鑰 */
export const MAP_STYLES: MapStyle[] = [
  {
    kind: 'vector',
    id: 'warm',
    name: '奶茶淡色',
    description: '照預覽圖配色重畫，地名中文優先',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
    transform: warmStyle,
    attribution: OFM_ATTR,
    preview: previewSvg({ bg: WARM.background, park: WARM.park, water: WARM.water, road: WARM.road, casing: WARM.roadCasing }),
  },
  {
    kind: 'vector',
    id: 'liberty',
    name: '清爽彩色',
    description: '柔和的彩色地圖，地名中文優先',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    transform: withChineseLabels,
    attribution: OFM_ATTR,
    preview: previewSvg({ bg: '#F8F4F0', park: '#D8E8C8', water: '#A0C8F0', road: '#FFFFFF', casing: '#E9AC77' }),
  },
  {
    kind: 'raster',
    id: 'osm',
    name: 'OSM 原版',
    description: 'OpenStreetMap 標準地圖，資訊最多',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTR,
    filter: 'none',
    maxZoom: 19,
    preview: OSM_PREVIEW,
  },
  {
    kind: 'raster',
    id: 'osm-warm',
    name: 'OSM 奶茶',
    description: '標準地圖加上褐色濾鏡',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTR,
    filter: OSM_WARM_FILTER,
    maxZoom: 19,
    preview: OSM_PREVIEW,
  },
]

/** 向量地圖載入失敗（例如第一次就離線）時改用的點陣地圖 */
export const FALLBACK_RASTER = MAP_STYLES.find((s) => s.id === 'osm-warm') as RasterStyle

export const DEFAULT_MAP_STYLE: MapStyleId = 'warm'

export function getMapStyle(id: string | undefined | null): MapStyle {
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES.find((s) => s.id === DEFAULT_MAP_STYLE)!
}

// ── 目前選的樣式（全 App 共用） ──

let current: MapStyleId = DEFAULT_MAP_STYLE
const listeners = new Set<() => void>()

getMeta<MapStyleId>('mapStyle').then((id) => {
  if (id && MAP_STYLES.some((s) => s.id === id) && id !== current) {
    current = id
    listeners.forEach((fn) => fn())
  }
})

export async function setMapStyle(id: MapStyleId): Promise<void> {
  current = id
  listeners.forEach((fn) => fn())
  await setMeta('mapStyle', id)
}

export function useMapStyle(): MapStyle {
  const id = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
  return getMapStyle(id)
}
