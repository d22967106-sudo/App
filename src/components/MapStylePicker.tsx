import { createPortal } from 'react-dom'
import { MAP_STYLES, previewTileUrl, setMapStyle, useMapStyle } from '../lib/mapStyles'
import { Icon } from './Icon'

/** 地圖樣式選擇：每種樣式顯示一小塊台北的實際圖磚當預覽 */
export function MapStylePicker() {
  const current = useMapStyle()
  return (
    <div className="style-grid" role="radiogroup" aria-label="地圖樣式">
      {MAP_STYLES.map((s) => (
        <button
          key={s.id}
          role="radio"
          aria-checked={current.id === s.id}
          className="style-option"
          onClick={() => setMapStyle(s.id)}
        >
          <span className="style-preview">
            <img src={previewTileUrl(s)} alt="" style={{ filter: s.filter }} loading="lazy" />
            {current.id === s.id && (
              <span className="style-check">
                <Icon name="check" size={16} strokeWidth={3} />
              </span>
            )}
          </span>
          <strong>{s.name}</strong>
          <small>{s.description}</small>
        </button>
      ))}
    </div>
  )
}

export function MapStyleSheet({ onClose }: { onClose: () => void }) {
  // 用 portal 放到 body，才蓋得過底部分頁
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="overlay-panel" role="dialog" aria-modal="true" aria-label="地圖樣式" onClick={(e) => e.stopPropagation()}>
        <div className="overlay-head">
          <h2>地圖樣式</h2>
          <button className="round-btn" aria-label="關閉" onClick={onClose} style={{ boxShadow: 'none', background: 'var(--soft)' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <MapStylePicker />
      </div>
    </div>,
    document.body,
  )
}
