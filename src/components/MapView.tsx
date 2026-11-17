import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { FALLBACK_RASTER, useMapStyle, type MapStyle, type RasterStyle } from '../lib/mapStyles'
import type { StyleSpec } from '../lib/vectorStyle'
import type { GeoPoint } from '../lib/types'

export interface MapMarker {
  id: string
  lat: number
  lng: number
  kind: 'money' | 'income' | 'diary' | 'checkin' | 'start'
  /** 有照片時直接在地圖上顯示縮圖 */
  thumbUrl?: string
  label: string
}

interface Props {
  route: GeoPoint[]
  markers: MapMarker[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** 播放中的位置 */
  playhead?: GeoPoint | null
  /** 小地圖：不能拖動 */
  static?: boolean
  /** 沒有任何點時的中心 */
  fallbackCenter: GeoPoint
  /** 地圖下方被面板擋住的高度，fit 時要避開 */
  bottomPadding?: number
  topPadding?: number
  className?: string
  ariaLabel: string
}

// MapLibre 的背景執行緒要另外打包，告訴它檔案在哪
setWorkerUrl(maplibreWorkerUrl)

const PRIMARY = '#A0612B'

const HOME_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>'
const PEN_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function iconFor(m: MapMarker, selected: boolean): L.DivIcon {
  const cls = `mk${selected ? ' selected' : ''}`
  if (m.thumbUrl) {
    return L.divIcon({
      className: '',
      html: `<div class="${cls}"><div class="mk-photo"><img src="${esc(m.thumbUrl)}" alt=""></div></div>`,
      iconSize: [52, 52],
      iconAnchor: [26, 58],
    })
  }
  const inner =
    m.kind === 'money'
      ? '<div class="mk mk-money">$</div>'
      : m.kind === 'income'
        ? '<div class="mk mk-money income">$</div>'
        : m.kind === 'diary'
          ? `<div class="mk mk-diary">${PEN_SVG}</div>`
          : m.kind === 'start'
            ? `<div class="mk mk-start">${HOME_SVG}</div>`
            : '<div class="mk mk-dot"></div>'
  const size = m.kind === 'checkin' ? 18 : m.kind === 'diary' ? 26 : 30
  return L.divIcon({
    className: '',
    html: `<div class="${cls}">${inner}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export function MapView({
  route,
  markers,
  selectedId,
  onSelect,
  playhead,
  static: isStatic = false,
  fallbackCenter,
  bottomPadding = 0,
  topPadding = 0,
  className,
  ariaLabel,
}: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const markerRefs = useRef(new Map<string, L.Marker>())
  const playRef = useRef<L.Marker | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const style = useMapStyle()

  // 建立地圖
  useEffect(() => {
    const el = elRef.current!
    const map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      dragging: !isStatic,
      touchZoom: !isStatic,
      doubleClickZoom: !isStatic,
      scrollWheelZoom: !isStatic,
      boxZoom: false,
      keyboard: !isStatic,
      tapHold: false,
    })
    map.attributionControl.setPrefix(false)
    layerRef.current = L.layerGroup().addTo(map)
    map.setView([fallbackCenter.lat, fallbackCenter.lng], 14)
    mapRef.current = map
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 底圖（換樣式時換掉）
  const [tileFilter, setTileFilter] = useState('none')
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let layer: L.Layer | null = null
    let cancelled = false

    const addRaster = (r: RasterStyle) => {
      setTileFilter(r.filter)
      layer = L.tileLayer(r.url, {
        maxZoom: r.maxZoom,
        subdomains: r.subdomains ?? 'abc',
        attribution: r.attribution,
      }).addTo(map)
      ;(layer as L.TileLayer).bringToBack()
    }

    const addStyle = async (st: MapStyle) => {
      if (st.kind === 'raster') return addRaster(st)
      setTileFilter('none')
      try {
        const spec = await loadVectorStyle(st.styleUrl)
        if (cancelled) return
        layer = maplibreGL({
          style: st.transform(spec) as never,
          attributionControl: false,
          // 中日韓文字用手機內建字型，不用下載
          localIdeographFontFamily: "'PingFang TC', 'Noto Sans TC', sans-serif",
        })
        layer.getAttribution = () => st.attribution
        layer.addTo(map)
      } catch {
        // 第一次就離線、或服務暫時連不到：改用點陣地圖
        if (!cancelled) addRaster(FALLBACK_RASTER)
      }
    }

    addStyle(style)
    return () => {
      cancelled = true
      layer?.remove()
    }
  }, [style])

  // 畫路線與標記
  const routeKey = JSON.stringify(route.map((p) => [p.lat, p.lng]))
  const markerKey = JSON.stringify(markers)
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    markerRefs.current.clear()
    const latlngs = route.map((p) => L.latLng(p.lat, p.lng))
    if (latlngs.length > 1) {
      L.polyline(latlngs, { color: '#FFFFFF', weight: 10, opacity: 1, lineJoin: 'round', interactive: false }).addTo(layer)
      L.polyline(latlngs, { color: PRIMARY, weight: 5, opacity: 1, lineJoin: 'round', interactive: false }).addTo(layer)
    }
    // 照片標記放最上面
    const sorted = [...markers].sort((a, b) => Number(!!a.thumbUrl) - Number(!!b.thumbUrl))
    for (const m of sorted) {
      const mk = L.marker([m.lat, m.lng], {
        icon: iconFor(m, m.id === selectedId),
        title: m.label,
        alt: m.label,
        keyboard: !isStatic,
        interactive: !isStatic,
        zIndexOffset: m.thumbUrl ? 500 : m.kind === 'checkin' ? -100 : 0,
      })
      if (!isStatic) mk.on('click', () => onSelectRef.current?.(m.id))
      mk.addTo(layer)
      markerRefs.current.set(m.id, mk)
    }
    const all = [...latlngs, ...markers.map((m) => L.latLng(m.lat, m.lng))]
    if (all.length === 1) {
      map.setView(all[0], 16, { animate: false })
    } else if (all.length > 1) {
      map.fitBounds(L.latLngBounds(all), {
        paddingTopLeft: [40, topPadding + 40],
        paddingBottomRight: [40, bottomPadding + 40],
        maxZoom: 17,
        animate: false,
      })
    } else {
      map.setView([fallbackCenter.lat, fallbackCenter.lng], 14, { animate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, markerKey, fallbackCenter.lat, fallbackCenter.lng])

  // 選取：換圖示並移到中間（避開下方面板）
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const m of markers) {
      markerRefs.current.get(m.id)?.setIcon(iconFor(m, m.id === selectedId))
    }
    const target = markers.find((m) => m.id === selectedId)
    if (target) {
      const zoom = Math.max(map.getZoom(), 15)
      const pt = map.project([target.lat, target.lng], zoom).add([0, (bottomPadding - topPadding) / 2])
      map.flyTo(map.unproject(pt, zoom), zoom, { duration: 0.6 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // 播放位置
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!playhead) {
      playRef.current?.remove()
      playRef.current = null
      return
    }
    if (!playRef.current) {
      playRef.current = L.marker([playhead.lat, playhead.lng], {
        icon: L.divIcon({ className: '', html: '<div class="mk mk-playhead"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(map)
    } else {
      playRef.current.setLatLng([playhead.lat, playhead.lng])
    }
  }, [playhead])

  return (
    <div
      ref={elRef}
      className={`map-fill map-tint ${className ?? ''}`}
      style={{ '--tile-filter': tileFilter } as React.CSSProperties}
      role="region"
      aria-label={ariaLabel}
    />
  )
}

const styleCache = new Map<string, Promise<StyleSpec>>()

/** 下載 OpenFreeMap 樣式 JSON（同一個網址只抓一次；離線時由 Service Worker 提供暫存） */
function loadVectorStyle(url: string): Promise<StyleSpec> {
  let p = styleCache.get(url)
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`style ${r.status}`)
      return r.json() as Promise<StyleSpec>
    })
    p.catch(() => styleCache.delete(url))
    styleCache.set(url, p)
  }
  return p
}
