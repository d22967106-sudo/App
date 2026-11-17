import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type React from 'react'
import { reverseGeocode } from '../lib/geocode'
import type { GeoPoint } from '../lib/types'
import { Icon } from './Icon'
import { useBaseLayer } from './MapView'

interface Props {
  /** 打開時地圖的中心 */
  start: GeoPoint
  onCancel: () => void
  onConfirm: (p: GeoPoint) => void
}

/**
 * 在地圖上手動調整位置：大頭針固定在畫面中間，拖動地圖讓它對準，再按「確定」。
 */
export function MapPicker({ start, onCancel, onConfirm }: Props) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [center, setCenter] = useState<GeoPoint>(start)
  const [dragging, setDragging] = useState(false)
  const [label, setLabel] = useState<string>('')
  const tileFilter = useBaseLayer(mapRef)

  useEffect(() => {
    const map = L.map(elRef.current!, { zoomControl: false, attributionControl: true })
    map.attributionControl.setPrefix(false)
    map.setView([start.lat, start.lng], 17)
    map.on('movestart', () => setDragging(true))
    map.on('moveend', () => {
      setDragging(false)
      const c = map.getCenter()
      setCenter({ lat: c.lat, lng: c.lng })
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 停下來時查一下這裡的地址，讓使用者確認
  useEffect(() => {
    if (dragging) return
    let alive = true
    setLabel('')
    const t = setTimeout(() => {
      reverseGeocode(center).then((g) => alive && setLabel(g ? (g.address ?? g.name) : ''))
    }, 400)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [center, dragging])

  return createPortal(
    <div className="picker" role="dialog" aria-modal="true" aria-label="在地圖上調整位置">
      <div
        ref={elRef}
        className="map-fill map-tint"
        style={{ '--tile-filter': tileFilter } as React.CSSProperties}
        aria-label="拖動地圖讓大頭針對準位置"
      />
      <div className={`picker-pin${dragging ? ' lifted' : ''}`} aria-hidden="true">
        <svg width="44" height="58" viewBox="0 0 44 58">
          <path d="M22 56 C 18 46 2 34 2 21 A 20 20 0 1 1 42 21 C 42 34 26 46 22 56 Z" fill="#A0612B" stroke="#fff" strokeWidth="3" />
          <circle cx="22" cy="21" r="8" fill="#fff" />
        </svg>
        <span className="picker-shadow" />
      </div>
      <div className="picker-top">
        <button className="round-btn" aria-label="取消" onClick={onCancel}>
          <Icon name="close" size={20} />
        </button>
        <div className="picker-hint">拖動地圖，讓大頭針對準位置</div>
      </div>
      <div className="picker-bottom">
        <div className="picker-label">
          <Icon name="pin" size={18} />
          <span>{dragging ? '移動中…' : label || '查詢地址中…'}</span>
        </div>
        <button className="btn-primary picker-ok" onClick={() => onConfirm(center)} disabled={dragging}>
          確定位置
        </button>
      </div>
    </div>,
    document.body,
  )
}
