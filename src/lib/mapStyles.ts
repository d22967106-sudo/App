import { useSyncExternalStore } from 'react'
import { getMeta, setMeta } from './db'

export type MapStyleId = 'carto-light' | 'carto-voyager' | 'osm' | 'osm-warm'

export interface MapStyle {
  id: MapStyleId
  name: string
  description: string
  url: string
  subdomains?: string
  attribution: string
  /** 套在圖磚上的 CSS 濾鏡，讓顏色接近焦糖奶茶 */
  filter: string
  maxZoom: number
}

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
const CARTO_ATTR = `${OSM_ATTR} © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>`

/** 全部都是 OpenStreetMap 資料、免費、不用金鑰 */
export const MAP_STYLES: MapStyle[] = [
  {
    id: 'carto-light',
    name: '奶茶淡色',
    description: '簡潔淺色底圖加暖色調，最接近預覽圖',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: CARTO_ATTR,
    filter: 'sepia(0.45) saturate(1.5) hue-rotate(-8deg) brightness(0.98)',
    maxZoom: 20,
  },
  {
    id: 'carto-voyager',
    name: '清爽彩色',
    description: '柔和的彩色地圖，公園、水域比較清楚',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: CARTO_ATTR,
    filter: 'sepia(0.12) saturate(0.95)',
    maxZoom: 20,
  },
  {
    id: 'osm',
    name: 'OSM 原版',
    description: 'OpenStreetMap 標準地圖，資訊最多',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTR,
    filter: 'none',
    maxZoom: 19,
  },
  {
    id: 'osm-warm',
    name: 'OSM 奶茶',
    description: '標準地圖加上褐色濾鏡',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM_ATTR,
    filter: 'sepia(0.35) saturate(0.75) brightness(1.02) contrast(0.92)',
    maxZoom: 19,
  },
]

export const DEFAULT_MAP_STYLE: MapStyleId = 'carto-light'

export function getMapStyle(id: string | undefined | null): MapStyle {
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES.find((s) => s.id === DEFAULT_MAP_STYLE)!
}

/** 預覽用：台北車站附近一張圖磚的網址 */
export function previewTileUrl(style: MapStyle): string {
  return style.url
    .replace('{s}', 'a')
    .replace('{z}', '15')
    .replace('{x}', '27445')
    .replace('{y}', '14027')
    .replace('{r}', '@2x')
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
