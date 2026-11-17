import { useEffect, useState, useSyncExternalStore } from 'react'
import { navigate, useRoute, usePhotoUrl } from '../lib/hooks'
import { Icon, type IconName } from './Icon'

// ── 提示訊息 ──

let toastMsg: { text: string; id: number } | null = null
const toastListeners = new Set<() => void>()
let toastTimer: ReturnType<typeof setTimeout> | undefined

export function toast(text: string, ms = 2600) {
  toastMsg = { text, id: Date.now() }
  for (const fn of toastListeners) fn()
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMsg = null
    for (const fn of toastListeners) fn()
  }, ms)
}

export function ToastHost() {
  const msg = useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn)
      return () => toastListeners.delete(fn)
    },
    () => toastMsg,
  )
  if (!msg) return null
  return (
    <div className="toast" role="status" key={msg.id}>
      {msg.text}
    </div>
  )
}

// ── 底部分頁 ──

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: 'map', label: '地圖', icon: 'map' },
  { path: 'calendar', label: '日曆', icon: 'calendar' },
  { path: 'trip', label: '旅程', icon: 'trip' },
  { path: 'stats', label: '統計', icon: 'stats' },
]

export function TabBar() {
  const route = useRoute()
  const active = route.path[0] || 'map'
  return (
    <nav className="tabbar" aria-label="主選單">
      {TABS.map((t) => (
        <a
          key={t.path}
          href={`#/${t.path}`}
          aria-current={active === t.path ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault()
            navigate(t.path, true)
          }}
        >
          <Icon name={t.icon} size={24} />
          {t.label}
        </a>
      ))}
    </nav>
  )
}

// ── 照片 ──

export function PhotoImg({ id, size = 'thumb', alt = '' }: { id: string; size?: 'thumb' | 'display'; alt?: string }) {
  const url = usePhotoUrl(id, size)
  return url ? <img src={url} alt={alt} loading="lazy" decoding="async" /> : null
}

/** 全螢幕看大圖，可左右切換 */
export function PhotoViewer({ ids, start, onClose }: { ids: string[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
      if (e.key === 'ArrowRight') setI((v) => Math.min(ids.length - 1, v + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids.length, onClose])
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="照片">
      <PhotoImg id={ids[i]} size="display" alt={`照片 ${i + 1}`} />
      <button className="round-btn close" aria-label="關閉" onClick={onClose}>
        <Icon name="close" />
      </button>
      {i > 0 && (
        <button className="round-btn prev" aria-label="上一張" onClick={() => setI(i - 1)}>
          <Icon name="chevronLeft" />
        </button>
      )}
      {i < ids.length - 1 && (
        <button className="round-btn next" aria-label="下一張" onClick={() => setI(i + 1)}>
          <Icon name="chevronRight" />
        </button>
      )}
      {ids.length > 1 && (
        <div className="count">
          {i + 1} / {ids.length}
        </div>
      )}
    </div>
  )
}
