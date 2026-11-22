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

export interface MapRoute {
  points: GeoPoint[]
  color: string
  dashed?: boolean
  /** 有 id 的路線可以點 */
  id?: string
  /** 線寬（預設 5） */
  weight?: number
  opacity?: number
  /** 不畫白邊（淡掉的路線用） */
  noCasing?: boolean
}

/** 除錯用：背景定位的原始點（小圓點，點了顯示時間與精確度） */
export interface MapDot extends GeoPoint {
  label: string
  /** App 不採用的點（精確度太差）畫成灰色 */
  unused?: boolean
  /** 選點模式：有 id 的點畫大一點、點了呼叫 onDotClick（不跳說明） */
  id?: string
  /** 選點模式：已選的點 */
  picked?: boolean
}

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
  /** 多段路線各自的顏色（旅程：每天一種顏色）；有給就不畫 route */
  routes?: MapRoute[]
  /** 點了某條有 id 的路線 */
  onRouteClick?: (id: string) => void
  /** 有給就把畫面對準這些點（例如選了一段路線） */
  focus?: GeoPoint[] | null
  markers: MapMarker[]
  /** 原始定位點（不影響畫面範圍） */
  dots?: MapDot[]
  /** 點了有 id 的原始點 */
  onDotClick?: (id: string) => void
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** 播放中的位置 */
  playhead?: GeoPoint | null
  /** 手繪模式：地圖不能拖動，用手指畫一條線，放開時回傳畫的點 */
  drawMode?: boolean
  onDrawEnd?: (points: GeoPoint[]) => void
  /** 按「定位」後的目前位置（at 變了就移過去） */
  myLocation?: (GeoPoint & { at: number }) | null
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
  routes,
  onRouteClick,
  focus,
  markers,
  dots,
  onDotClick,
  selectedId,
  onSelect,
  playhead,
  drawMode = false,
  onDrawEnd,
  myLocation,
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
  const meRef = useRef<L.Marker | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onRouteClickRef = useRef(onRouteClick)
  onRouteClickRef.current = onRouteClick
  const onDotClickRef = useRef(onDotClick)
  onDotClickRef.current = onDotClick
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
  const tileFilter = useBaseLayer(mapRef)

  // 畫路線與標記
  const routeKey = JSON.stringify([route.map((p) => [p.lat, p.lng]), routes?.map((r) => [r.id, r.color, r.dashed, r.weight, r.opacity, r.noCasing, r.points.map((p) => [p.lat, p.lng])])])
  const markerKey = JSON.stringify([markers, dots])
  const lastFit = useRef('')
  const focusKey = focus ? JSON.stringify(focus.map((p) => [p.lat, p.lng])) : ''
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    markerRefs.current.clear()
    const lines: MapRoute[] = routes ?? [{ points: route, color: PRIMARY }]
    const latlngs: L.LatLng[] = []
    for (const line of lines) {
      const ll = line.points.map((p) => L.latLng(p.lat, p.lng))
      latlngs.push(...ll)
      if (ll.length > 1 && !line.noCasing)
        L.polyline(ll, { color: '#FFFFFF', weight: (line.weight ?? 5) + 5, opacity: 1, lineJoin: 'round', interactive: false }).addTo(layer)
    }
    for (const line of lines) {
      const ll = line.points.map((p) => L.latLng(p.lat, p.lng))
      if (ll.length < 2) continue
      L.polyline(ll, {
        color: line.color,
        weight: line.weight ?? 5,
        opacity: line.opacity ?? 1,
        lineJoin: 'round',
        dashArray: line.dashed ? '10 9' : undefined,
        interactive: false,
      }).addTo(layer)
      // 可以點的路線：疊一條看不見的粗線，手指比較好點到
      if (line.id && !isStatic) {
        const id = line.id
        L.polyline(ll, { color: '#000', weight: 24, opacity: 0, interactive: true })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e)
            onRouteClickRef.current?.(id)
          })
          .addTo(layer)
      }
    }
    for (const d of dots ?? []) {
      if (d.id && !isStatic) {
        const id = d.id
        L.circleMarker([d.lat, d.lng], {
          radius: d.picked ? 10 : 7,
          color: '#FFFFFF',
          weight: 2.5,
          fillColor: d.picked ? '#D9480F' : '#2B6CB0',
          fillOpacity: 1,
          interactive: false,
        }).addTo(layer)
        // 看不見的大圓，手指比較好點到
        L.circleMarker([d.lat, d.lng], { radius: 18, stroke: false, fillOpacity: 0, interactive: true })
          .on('click', (e) => {
            L.DomEvent.stopPropagation(e)
            onDotClickRef.current?.(id)
          })
          .addTo(layer)
        continue
      }
      L.circleMarker([d.lat, d.lng], {
        radius: 4,
        color: '#FFFFFF',
        weight: 1.5,
        fillColor: d.unused ? '#9A9A9A' : '#2B6CB0',
        fillOpacity: 0.9,
        interactive: !isStatic,
      })
        .bindPopup(esc(d.label))
        .addTo(layer)
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
    const all = focus?.length ? focus.map((p) => L.latLng(p.lat, p.lng)) : [...latlngs, ...markers.map((m) => L.latLng(m.lat, m.lng))]
    // 有對焦目標時，只有目標換了才重新縮放（手繪修改、貼齊完成只是線變了，使用者放大的畫面不要被重設）
    const fitKey = focus?.length ? `f:${focusKey}` : `a:${routeKey}|${markerKey}`
    if (focus?.length && fitKey === lastFit.current) return
    lastFit.current = fitKey
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
  }, [routeKey, markerKey, focusKey, fallbackCenter.lat, fallbackCenter.lng])

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

  // 目前位置：顯示圓點並移過去（不記錄）
  useEffect(() => {
    const map = mapRef.current
    if (!map || !myLocation) return
    const ll = L.latLng(myLocation.lat, myLocation.lng)
    if (!meRef.current) {
      meRef.current = L.marker(ll, {
        icon: L.divIcon({ className: '', html: '<div class="mk mk-me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 900,
      }).addTo(map)
    } else {
      meRef.current.setLatLng(ll)
    }
    const zoom = Math.max(map.getZoom(), 16)
    const pt = map.project(ll, zoom).add([0, (bottomPadding - topPadding) / 2])
    map.flyTo(map.unproject(pt, zoom), zoom, { duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myLocation?.at])

  // 手繪模式：鎖住地圖，手指畫線
  const onDrawEndRef = useRef(onDrawEnd)
  onDrawEndRef.current = onDrawEnd
  useEffect(() => {
    const map = mapRef.current
    const el = elRef.current
    if (!map || !el || !drawMode) return
    // 一根手指畫線；兩根手指照樣可以縮放（Leaflet 的兩指縮放用 touch 事件，不受下面攔 pointer 影響）
    map.dragging.disable()
    map.doubleClickZoom.disable()
    map.scrollWheelZoom.disable()
    const prevTouch = el.style.touchAction
    el.style.touchAction = 'none'
    let line: L.Polyline | null = null
    let pts: L.LatLng[] = []
    let drawing = false
    const fingers = new Set<number>()
    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return map.containerPointToLatLng(L.point(e.clientX - r.left, e.clientY - r.top))
    }
    const down = (e: PointerEvent) => {
      fingers.add(e.pointerId)
      if (fingers.size > 1) {
        // 第二根手指：取消這一筆，讓它縮放
        drawing = false
        line?.remove()
        line = null
        return
      }
      e.preventDefault()
      e.stopPropagation()
      drawing = true
      el.setPointerCapture?.(e.pointerId)
      pts = [at(e)]
      line?.remove()
      line = L.polyline(pts, { color: '#B5473A', weight: 5, opacity: 0.9, interactive: false }).addTo(map)
    }
    const move = (e: PointerEvent) => {
      if (!drawing) return
      e.preventDefault()
      e.stopPropagation()
      const p = at(e)
      if (map.latLngToContainerPoint(p).distanceTo(map.latLngToContainerPoint(pts[pts.length - 1])) < 3) return
      pts.push(p)
      line?.setLatLngs(pts)
    }
    const up = (e: PointerEvent) => {
      fingers.delete(e.pointerId)
      if (!drawing) return
      e.preventDefault()
      e.stopPropagation()
      drawing = false
      if (pts.length >= 2) onDrawEndRef.current?.(pts.map((p) => ({ lat: p.lat, lng: p.lng })))
    }
    // capture：在 Leaflet 自己的處理之前攔下來
    el.addEventListener('pointerdown', down, true)
    el.addEventListener('pointermove', move, true)
    el.addEventListener('pointerup', up, true)
    el.addEventListener('pointercancel', up, true)
    return () => {
      el.removeEventListener('pointerdown', down, true)
      el.removeEventListener('pointermove', move, true)
      el.removeEventListener('pointerup', up, true)
      el.removeEventListener('pointercancel', up, true)
      line?.remove()
      el.style.touchAction = prevTouch
      if (!isStatic) {
        map.dragging.enable()
        map.doubleClickZoom.enable()
        map.scrollWheelZoom.enable()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode])

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


/** 依目前選的地圖樣式加上底圖（向量或點陣），回傳點陣圖要套的 CSS 濾鏡。新增紀錄的地圖選點也用這個 */
export function useBaseLayer(mapRef: React.RefObject<L.Map | null>): string {
  const style = useMapStyle()
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
  }, [style, mapRef])
  return tileFilter
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
