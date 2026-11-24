import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Icon } from '../components/Icon'
import { MapView, type MapDot, type MapMarker, type MapRoute } from '../components/MapView'
import { MapStyleSheet } from '../components/MapStylePicker'
import { toast } from '../components/ui'
import { getCategory } from '../lib/categories'
import { formatTwd } from '../lib/currency'
import { buildRoute, buildTimeline, dayStats, dayStays, type RoutePoint, type TimelineItem } from '../lib/day'
import { getEntriesByDate, getMeta, getPhoto, getSteps, getTrackBefore, getTrackByDate, onPhotoThumb, setMeta } from '../lib/db'
import { entrySubtitle, entryTitle, shortAmount } from '../lib/display'
import { distanceM, getCurrentPosition } from '../lib/geo'
import { navigate, useLiveQuery } from '../lib/hooks'
import { formatDateLong, formatTime, isDateKey, relativeDayLabel, shiftDate, toDateKey } from '../lib/ledger'
import { useStayNames } from '../lib/stayNames'
import { applyCuts, carryPoint, computeLegs, guessMode, isCarry, modeName, TRAVEL_MODES, withCarry, type Leg, type TravelMode } from '../lib/legs'
import { getLegCuts, getLegEdits, getLegModes, planRoute, updateLegCuts, getRouteSettings, getSnapCache, onRouteSettingsChange, setLegEdit, setLegMode, snapDrawn, snapLeg, spliceLine, DEFAULT_ROUTE_SETTINGS, type RouteSettings } from '../lib/snap'
import { isAuto, MAX_ACCURACY } from '../lib/stays'
import { historyState, onHistoryChange, redoRoute, routeStep, undoRoute } from '../lib/routeHistory'
import { entryEditLine, getEntryEdits, lineKm, nextAnchor, onEntryEditsChange, routeWithEntryEdits, setEntryEdit, type EntryEdits } from '../lib/entryRoute'
import type { Entry, GeoPoint } from '../lib/types'

const TAIPEI: GeoPoint = { lat: 25.0418, lng: 121.5435 }
const PRIMARY = '#A0612B'
const LEG_ON = '#7A4A20'
const LEG_OFF = '#C9AE93'
/** 選了一段時面板的高度 */
const LEG_SHEET_H = 150

/** 28 分、1 小時 5 分 */
function formatDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60000))
  return min < 60 ? `${min} 分` : `${Math.floor(min / 60)} 小時${min % 60 ? ` ${min % 60} 分` : ''}`
}

/** 11/19 22:10 */
/** 建置時間（台灣時間）：2026-11-22 00:15 → 11/22 00:15 */
const APP_VERSION = __BUILD_DATE__.replace(/^\d+-0?(\d+)-0?(\d+)/, '$1/$2')

function formatShort(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(ms)}`
}

type LegEdits = Record<string, [number, number][]>

/** 路線設定、手動選的交通方式、手繪修改的路線（設定頁或卡片改了會跟著變） */
type RouteState = { settings: RouteSettings; legModes: Record<string, TravelMode>; legEdits: LegEdits; legCuts: Record<string, number[]> }

function useRouteSettings(): RouteState {
  const [st, setSt] = useState<RouteState>({ settings: DEFAULT_ROUTE_SETTINGS, legModes: {}, legEdits: {}, legCuts: {} })
  useEffect(() => {
    const load = () =>
      Promise.all([getRouteSettings(), getLegModes(), getLegEdits(), getLegCuts()]).then(([settings, legModes, legEdits, legCuts]) =>
        setSt({ settings, legModes, legEdits, legCuts }),
      )
    load()
    return onRouteSettingsChange(load)
  }, [])
  return st
}

type Item = TimelineItem | { type: 'leg'; time: number; leg: Leg }

/** 每筆紀錄第一張照片的縮圖網址，給地圖用 */
function useThumbUrls(entries: Entry[] | undefined): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  // 從雲端同步下來的縮圖下載完時要重新讀
  const [thumbTick, setThumbTick] = useState(0)
  useEffect(() => onPhotoThumb(() => setThumbTick((t) => t + 1)), [])
  const key = (entries?.map((e) => `${e.id}:${e.photoIds[0] ?? ''}`).join(',') ?? '') + `#${thumbTick}`
  useEffect(() => {
    let alive = true
    const made: string[] = []
    ;(async () => {
      const out: Record<string, string> = {}
      for (const e of entries ?? []) {
        if (!e.location || !e.photoIds[0]) continue
        const p = await getPhoto(e.photoIds[0])
        if (!p?.thumb) continue
        const u = URL.createObjectURL(p.thumb)
        made.push(u)
        out[e.id] = u
      }
      if (alive) setUrls(out)
    })()
    return () => {
      alive = false
      made.forEach((u) => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return urls
}

/** 面板高度：收起時看得到總計和前幾筆，拉開時幾乎全螢幕 */
function useSheetHeights() {
  const calc = () => {
    const h = window.innerHeight
    return { peek: Math.round(Math.max(250, Math.min(330, h * 0.39))), full: Math.round(h - 150) }
  }
  const [sizes, setSizes] = useState(calc)
  useEffect(() => {
    const on = () => setSizes(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return sizes
}

export function MapPage({ date: rawDate }: { date: string | null }) {
  const today = toDateKey(new Date())
  const date = rawDate && isDateKey(rawDate) ? rawDate : today
  const entries = useLiveQuery(() => getEntriesByDate(date), [date])
  const track = useLiveQuery(() => getTrackByDate(date), [date])
  const steps = useLiveQuery(() => getSteps(date), [date])
  const lastPos = useLiveQuery(() => getMeta<GeoPoint>('lastPos'), [])
  const thumbs = useThumbUrls(entries)
  const [selected, setSelected] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [showStyles, setShowStyles] = useState(false)

  const { peek, full } = useSheetHeights()
  const [sheetH, setSheetH] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const height = sheetH ?? peek
  const expanded = height > (peek + full) / 2

  useEffect(() => setSelected(null), [date])

  // 接上前一天的最後位置：今天 0 點時人就在那裡（今天沒收到點也看得到在哪）
  const before = useLiveQuery(() => (date <= today ? getTrackBefore(date) : Promise.resolve([])), [date, today])
  const rawTrack = track
  const fullTrack = useMemo(() => (rawTrack ? withCarry(rawTrack, before ? carryPoint(date, before) : null) : undefined), [rawTrack, before, date])

  const route = useMemo(() => buildRoute(entries ?? [], fullTrack ?? []), [entries, fullTrack])
  const stays = useMemo(() => dayStays(fullTrack ?? []), [fullTrack])
  const stayNames = useStayNames(stays, entries)
  const timeline = useMemo(() => buildTimeline(entries ?? [], fullTrack ?? [], stays), [entries, fullTrack, stays])
  const stats = useMemo(() => dayStats(entries ?? [], fullTrack ?? [], stays), [entries, fullTrack, stays])
  // 最後位置不管精確度，只要有收到就標出來（看得出資料有進來）
  const lastAuto = useMemo(() => (fullTrack ?? []).filter(isAuto).sort((a, b) => a.time - b.time).at(-1) ?? null, [fullTrack])

  // ── 一段一段的移動、交通方式、貼齊道路 ──
  const { settings: routeSettings, legModes, legEdits, legCuts } = useRouteSettings()
  const dayCuts = legCuts[date]
  const legs = useMemo(() => applyCuts(computeLegs(fullTrack ?? [], stays), dayCuts ?? []), [fullTrack, stays, dayCuts])
  const modeOf = useCallback(
    (l: Leg): { mode: TravelMode; auto: boolean } => {
      const manual = legModes[`${date}/${l.id}`]
      return manual ? { mode: manual, auto: false } : { mode: guessMode(l, routeSettings.mode), auto: true }
    },
    [legModes, date, routeSettings.mode],
  )
  const [snapped, setSnapped] = useState<Record<string, GeoPoint[] | null | 'pending'>>({})
  const snapKey = legs.map((l) => `${l.id}:${l.points.length}:${modeOf(l).mode}`).join('|') + `#${routeSettings.snap}`
  useEffect(() => {
    if (!routeSettings.snap) {
      setSnapped({})
      return
    }
    let alive = true
    setSnapped(Object.fromEntries(legs.filter((l) => modeOf(l).mode !== 'none').map((l) => [l.id, 'pending' as const])))
    ;(async () => {
      for (const l of legs) {
        const mode = modeOf(l).mode
        if (mode === 'none') continue
        const pts = await snapLeg(l.points, mode)
        if (!alive) return
        setSnapped((s) => ({ ...s, [l.id]: pts }))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapKey])
  /** 手繪修改過的路線（沒有就 null） */
  const editOf = (l: Leg): GeoPoint[] | null => legEdits[`${date}/${l.id}`]?.map(([lat, lng]) => ({ lat, lng })) ?? null
  const legLine = (l: Leg): GeoPoint[] => {
    const ed = editOf(l)
    if (ed) return ed
    const sp = snapped[l.id]
    return sp && sp !== 'pending' ? sp : l.points
  }
  /** 這段的公里數（手繪修改過就用畫的線算） */
  const legKm = (l: Leg): number => {
    const ed = editOf(l)
    if (!ed) return l.km
    let m = 0
    for (let i = 1; i < ed.length; i++) m += distanceM(ed[i - 1], ed[i])
    return Math.round(m / 100) / 10
  }
  // 手繪修改：畫線中、貼齊道路中
  const [drawing, setDrawing] = useState(false)
  const [drawBusy, setDrawBusy] = useState(false)
  const [legSel, setLegSel] = useState<string | null>(null)
  // 手動切出一段：null＝沒在選；'start'＝等起點；數字＝已選的起點時間
  const [cutting, setCutting] = useState<null | 'start' | number>(null)
  useEffect(() => {
    setDrawing(false)
    setCutting(null)
    if (legSel) setEntryCard(null)
  }, [legSel, date])
  useEffect(() => setLegSel(null), [date])
  const pickedLeg = legs.find((l) => l.id === legSel) ?? null

  // ── 從記帳點手繪路線 ──
  const [entryEdits, setEntryEdits] = useState<EntryEdits>({})
  useEffect(() => {
    let alive = true
    const load = () => getEntryEdits(date).then((e) => alive && setEntryEdits(e))
    load()
    const off = onEntryEditsChange(load)
    return () => {
      alive = false
      off()
    }
  }, [date])
  /** 正在看／畫哪一筆紀錄出發的路線 */
  const [entryCard, setEntryCard] = useState<{ id: string; drawing: boolean } | null>(null)
  useEffect(() => setEntryCard(null), [date])
  const autoIds = useMemo(() => new Set((fullTrack ?? []).filter(isAuto).map((t) => t.id)), [fullTrack])
  const isAnchor = useCallback((p: RoutePoint) => p.ref.type === 'entry' || !autoIds.has(p.ref.id), [autoIds])
  const cardEntry = entryCard ? ((entries ?? []).find((e) => e.id === entryCard.id && e.location) ?? null) : null
  // 有背景定位的移動時，手繪的線另外畫一條，接到下一筆有地點的紀錄（不接背景定位的點）
  const anchorOf = useCallback((p: RoutePoint) => (legs.length ? p.ref.type === 'entry' : isAnchor(p)), [legs.length, isAnchor])
  const cardNext = cardEntry ? nextAnchor(route, cardEntry.id, anchorOf) : null
  /** 這筆紀錄出發的路線要用的交通方式（自動生成用） */
  const [entryMode, setEntryMode] = useState<TravelMode>(routeSettings.mode)
  useEffect(() => setEntryMode(routeSettings.mode), [entryCard?.id, routeSettings.mode])
  const autoEntryRoute = async (e: Entry) => {
    if (!e.location || !cardNext) return
    setDrawBusy(true)
    const line = await planRoute(e.location, cardNext, entryMode)
    setDrawBusy(false)
    if (!line) {
      if (entryMode === 'none') {
        const loc = e.location
        await routeStep(() => setEntryEdit(date, e.id, [loc, cardNext]))
        return toast('已用直線連起來（不貼齊）')
      }
      return toast('規劃路線失敗（連不上路線服務），可以改用手繪', 3500)
    }
    await routeStep(() => setEntryEdit(date, e.id, line))
    toast(`已沿道路連到下一個地點（${modeName(entryMode)}）`)
  }
  const anchorLabel = (p: RoutePoint): string => {
    if (p.ref.type === 'entry') {
      const e = (entries ?? []).find((x) => x.id === p.ref.id)
      return `${formatTime(p.time)} ${e ? entryTitle(e) : ''}`
    }
    const t = (fullTrack ?? []).find((x) => x.id === p.ref.id)
    return `${formatTime(p.time)} 定位${t?.label ? ' ' + t.label : ''}`
  }
  /** 這筆紀錄出發的整條線（含頭尾） */
  const entryLine = (e: Entry, next: GeoPoint | null): GeoPoint[] | null => {
    const ed = entryEdits[e.id]
    return ed && e.location ? entryEditLine(e.location, ed, next) : null
  }
  const openEntryRoute = (e: Entry) => {
    setLegSel(null)
    setSelected(e.id)
    setEntryCard({ id: e.id, drawing: false })
    setSheetH(LEG_SHEET_H)
  }
  /** 地圖上畫的線：沒有背景定位移動的日子，記帳點手繪的路線接進紀錄的連線裡 */
  const displayRoute = useMemo(
    () => (legs.length || !Object.keys(entryEdits).length ? route : routeWithEntryEdits(route, entryEdits, isAnchor)),
    [legs.length, route, entryEdits, isAnchor],
  )
  const snapStatus = useMemo(() => {
    if (!routeSettings.snap) return null
    const vals = legs.filter((l) => modeOf(l).mode !== 'none').map((l) => snapped[l.id])
    if (!vals.length) return null
    if (vals.some((v) => v === 'pending')) return '貼齊道路中…'
    if (vals.every((v) => v)) return `已貼齊道路（${modeName(routeSettings.mode)}）`
    return vals.some((v) => v) ? '部分路段沒有貼齊（連不上服務或比對失敗）' : '貼齊道路失敗，先畫直線'
  }, [legs, snapped, routeSettings, modeOf])

  // 有背景定位的移動時，地圖畫一段一段的路線（可以點）；否則照舊連紀錄和定位點
  const mapRoutes = useMemo<MapRoute[] | undefined>(() => {
    if (!legs.length) return undefined
    const out: MapRoute[] = legs.map((l) =>
      !legSel
        ? { id: l.id, points: legLine(l), color: PRIMARY }
        : l.id === legSel
          ? { id: l.id, points: legLine(l), color: LEG_ON, weight: 7 }
          : { id: l.id, points: legLine(l), color: LEG_OFF, weight: 4, opacity: 0.75, noCasing: true },
    )
    // 從記帳點手繪的路線
    for (const e of entries ?? []) {
      const line = entryLine(e, nextAnchor(route, e.id, anchorOf))
      if (!line || line.length < 2) continue
      const on = entryCard?.id === e.id
      out.push(
        legSel ? { id: `entry:${e.id}`, points: line, color: LEG_OFF, weight: 4, opacity: 0.75, noCasing: true } : { id: `entry:${e.id}`, points: line, color: on ? LEG_ON : PRIMARY, weight: on ? 7 : undefined },
      )
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, snapped, legSel, legEdits, entries, entryEdits, entryCard?.id, route, anchorOf])

  const items = useMemo<Item[]>(() => {
    if (!legs.length) return timeline
    // 「離開 ○○」併進「移動」那一列
    const leaving = new Set(legs.map((l) => l.from?.id).filter(Boolean))
    return [
      ...timeline.filter((it) => !(it.type === 'stay' && it.edge === 'leave' && leaving.has(it.stay.id))),
      ...legs.map((leg) => ({ type: 'leg' as const, time: leg.start, leg })),
    ].sort((a, b) => a.time - b.time)
  }, [timeline, legs])

  const placeName = (stay: Leg['from']) => (stay ? (stayNames[stay.id] ?? '…') : null)
  const legTitle = (l: Leg, i: number) => {
    const from = placeName(l.from) ?? l.fromLabel ?? (i === 0 ? '起點' : '…')
    const to = placeName(l.to) ?? l.toLabel ?? (date === today && i === legs.length - 1 ? '目前位置' : '終點')
    return `${from} → ${to}`
  }

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = []
    const manual = (fullTrack ?? []).filter((t) => !isAuto(t))
    const firstTrack = manual[0]
    // 背景定位：起點一個標記，停留的地方各一個標記（路上經過的點只畫線）
    const first = route[0]
    if (first && first.ref.type === 'track' && route.length > 1 && !manual.some((t) => t.id === first.ref.id)) {
      out.push({ id: first.ref.id, lat: first.lat, lng: first.lng, kind: 'start', label: `${formatTime(legs[0]?.start ?? first.time)} 出發` })
    }
    // 背景定位的最後位置（還沒有停留、也還沒移動時，至少看得到資料有進來）
    if (lastAuto && !out.some((m) => m.id === lastAuto.id)) {
      out.push({
        id: lastAuto.id,
        lat: lastAuto.lat,
        lng: lastAuto.lng,
        kind: 'checkin',
        label: isCarry(lastAuto) ? `整天在這裡（最後更新 ${formatShort(lastAuto.carriedFrom!)}）` : `${formatTime(lastAuto.time)} 最後位置`,
      })
    }
    for (const s of stays) {
      out.push({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        kind: 'checkin',
        label: `${formatTime(s.start)}–${formatTime(s.end)} ${stayNames[s.id] ?? '停留'}`,
      })
    }
    for (const t of manual) {
      const isStart = t === firstTrack && route[0]?.ref.id === t.id && route.length > 1
      out.push({
        id: t.id,
        lat: t.lat,
        lng: t.lng,
        kind: isStart ? 'start' : 'checkin',
        label: `${formatTime(t.time)} 定位${t.label ? ' ' + t.label : ''}`,
      })
    }
    for (const e of entries ?? []) {
      if (!e.location) continue
      out.push({
        id: e.id,
        lat: e.location.lat,
        lng: e.location.lng,
        kind: e.kind === 'diary' ? 'diary' : e.kind === 'income' ? 'income' : 'money',
        thumbUrl: thumbs[e.id],
        label: `${formatTime(e.time)} ${entryTitle(e)}`,
      })
    }
    return out
  }, [entries, fullTrack, thumbs, route, stays, stayNames, lastAuto, legs])

  // 除錯：背景定位的原始點（設定頁「路線」打開）
  const dots = useMemo<MapDot[] | undefined>(() => {
    // 手動切段：這段用到的每個點都可以點來當起點／終點
    if (cutting != null && pickedLeg)
      return pickedLeg.points.map((p) => ({ lat: p.lat, lng: p.lng, id: String(p.time), picked: p.time === cutting, label: formatTime(p.time) }))
    if (!routeSettings.rawPoints || !rawTrack) return undefined
    return rawTrack
      .filter(isAuto)
      .sort((a, b) => a.time - b.time)
      .map((p) => {
        const unused = p.accuracy != null && p.accuracy > MAX_ACCURACY
        const t = new Date(p.time)
        const sec = String(t.getSeconds()).padStart(2, '0')
        return { lat: p.lat, lng: p.lng, unused, label: `${formatTime(p.time)}:${sec} · 精確度 ${p.accuracy != null ? `±${p.accuracy} m` : '不明'}${unused ? '（太差，不採用）' : ''}` }
      })
  }, [routeSettings.rawPoints, rawTrack, cutting, pickedLeg])

  const onCutPoint = async (id: string) => {
    if (!pickedLeg || cutting == null) return
    const t = Number(id)
    if (cutting === 'start') {
      if (t === pickedLeg.end) return toast('起點不能選這段的最後一個點', 2500)
      setCutting(t)
      return
    }
    if (t === cutting) return setCutting('start')
    const a = Math.min(cutting, t)
    const b = Math.max(cutting, t)
    if (a === pickedLeg.start && b === pickedLeg.end) {
      setCutting(null)
      return toast('選的是整段，不用切；直接在下面選交通方式就好', 3000)
    }
    // 切開後原本手繪修改的線對不上了，拿掉
    const leg = pickedLeg
    await routeStep(async () => {
      if (editOf(leg)) await setLegEdit(date, leg.id, null)
      await updateLegCuts(date, [a, b].filter((x) => x !== leg.start && x !== leg.end))
    })
    setCutting(null)
    setLegSel(`leg-${a}`)
    toast(`已切出 ${formatTime(a)}–${formatTime(b)}，可以選這段的交通方式`, 3000)
  }

  const onUncut = async (l: Leg) => {
    const remove = [...(l.cutStart ? [l.start] : []), ...(l.cutEnd ? [l.end] : [])]
    // 合併後的段 id 會變，切點兩邊的手繪修改都對不上，拿掉
    await routeStep(async () => {
      for (const x of legs) if ((x.end === l.start && l.cutStart) || (x.start === l.end && l.cutEnd) || x === l) if (editOf(x)) await setLegEdit(date, x.id, null)
      await updateLegCuts(date, [], remove)
    })
    setLegSel(null)
    toast('已合併回前後段')
  }

  const copyRawPoints = async () => {
    const pts0 = (rawTrack ?? []).filter(isAuto).length
    const build = async (): Promise<string> => {
    const pts = (rawTrack ?? []).filter(isAuto).sort((a, b) => a.time - b.time)
    const pad = (n: number) => String(n).padStart(2, '0')
    const lines = pts.map((p) => {
      const t = new Date(p.time)
      return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())},${p.lat.toFixed(6)},${p.lng.toFixed(6)},${p.accuracy ?? ''}`
    })
    // 各段畫在地圖上的線（貼齊道路後的結果），除錯貼齊用
    const fmt = (ps: GeoPoint[]) => ps.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(' ')
    const legLines = await Promise.all(
      legs.map(async (l, i) => {
        const mode = modeOf(l).mode
        const line = legLine(l)
        const rawSnap = await getSnapCache(l.points, mode)
        return [
          `# 第 ${i + 1} 段 ${formatTime(l.start)}–${formatTime(l.end)} ${modeName(mode)}`,
          `## 這段用的點（時間,緯度,經度,精確度）`,
          l.points.map((p) => `${new Date(p.time).toTimeString().slice(0, 8)},${p.lat.toFixed(6)},${p.lng.toFixed(6)},${p.accuracy ?? ''}`).join(' '),
          `## 貼齊服務回傳 ${rawSnap ? rawSnap.length + ' 點' : '（沒有）'}`,
          rawSnap ? fmt(rawSnap) : '',
          `## 畫出的線 ${line.length} 點`,
          fmt(line),
        ].join('\n')
      }),
    )
    return [`摳摳手帳原始定位點 ${date}（時間,緯度,經度,精確度m）共 ${pts.length} 點`, ...lines, ...legLines].join('\n')
    }
    try {
      // iPhone Safari 要在按下的當下開始寫剪貼簿：先交給 ClipboardItem 一個還在準備的內容
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': build().then((t) => new Blob([t], { type: 'text/plain' })) })])
      } else {
        await navigator.clipboard.writeText(await build())
      }
      toast(`已複製 ${pts0} 個點`)
    } catch {
      toast('複製失敗，請再按一次', 3000)
    }
  }

  // ── 播放當天行程 ──
  const [playhead, setPlayhead] = useState<GeoPoint | null>(null)
  const playRaf = useRef<number | null>(null)
  const stopPlay = useCallback(() => {
    if (playRaf.current != null) cancelAnimationFrame(playRaf.current)
    playRaf.current = null
    setPlayhead(null)
  }, [])
  useEffect(() => stopPlay, [stopPlay, date])

  const play = () => {
    if (playRaf.current != null) {
      stopPlay()
      return
    }
    const pts: RoutePoint[] = route
    if (pts.length < 2) return
    const segMs = Math.min(1600, 12000 / (pts.length - 1))
    const startAt = performance.now()
    let lastIdx = -1
    setSheetH(peek)
    const tick = (now: number) => {
      const t = (now - startAt) / segMs
      const i = Math.min(Math.floor(t), pts.length - 1)
      if (i !== lastIdx) {
        lastIdx = i
        setSelected(pts[i].ref.id)
      }
      if (i >= pts.length - 1) {
        setPlayhead({ lat: pts[i].lat, lng: pts[i].lng })
        playRaf.current = null
        setTimeout(() => setPlayhead(null), 800)
        return
      }
      const f = t - i
      const a = pts[i]
      const b = pts[i + 1]
      setPlayhead({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f })
      playRaf.current = requestAnimationFrame(tick)
    }
    playRaf.current = requestAnimationFrame(tick)
  }

  // ── 定位：把地圖移到目前位置（不記錄） ──
  const [myPos, setMyPos] = useState<(GeoPoint & { at: number }) | null>(null)
  const locateMe = async () => {
    setCheckingIn(true)
    try {
      const pos = await getCurrentPosition()
      await setMeta('lastPos', { lat: pos.lat, lng: pos.lng })
      setSelected(null)
      setMyPos({ lat: pos.lat, lng: pos.lng, at: Date.now() })
    } catch (e) {
      toast((e as Error).message, 4000)
    } finally {
      setCheckingIn(false)
    }
  }

  // ── 拖動面板 ──
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null)
  const onDown = (e: RPointerEvent) => {
    drag.current = { y: e.clientY, h: height, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dy = d.y - e.clientY
    if (Math.abs(dy) > 4) {
      d.moved = true
      setDragging(true)
    }
    if (d.moved) setSheetH(Math.max(140, Math.min(full, d.h + dy)))
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d) return
    if (!d.moved) {
      setSheetH(expanded ? peek : full)
      return
    }
    setSheetH(height > (peek + full) / 2 ? full : peek)
  }

  const label = relativeDayLabel(date, today)
  const isToday = date === today
  const listRef = useRef<HTMLDivElement>(null)

  // 點地圖標記 → 時間軸捲到那一筆
  useEffect(() => {
    if (!selected) return
    listRef.current?.querySelector(`[data-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  const loaded = entries && track

  // 路線操作的上一步／下一步
  const [hist, setHist] = useState(historyState)
  useEffect(() => onHistoryChange(() => setHist(historyState())), [])
  const busyDraw = drawing || !!entryCard?.drawing || cutting != null || drawBusy
  // 手繪、選點切段時藏起來（不要擋到要畫的地方）
  const showHist = (hist.canUndo || hist.canRedo) && !(drawing || entryCard?.drawing || cutting != null) && !pickedLeg && !cardEntry
  const onUndo = async () => (await undoRoute()) && toast('已回到上一步')
  const onRedo = async () => (await redoRoute()) && toast('已到下一步')
  const histCtl: HistCtl | undefined = hist.canUndo || hist.canRedo ? { canUndo: hist.canUndo && !busyDraw, canRedo: hist.canRedo && !busyDraw, onUndo, onRedo } : undefined
  const legIndex = pickedLeg ? legs.indexOf(pickedLeg) : -1
  const pickLeg = (id: string | null) => {
    setLegSel(id)
    if (id) {
      setSelected(null)
      // 上面有卡片，面板收到最低，地圖才有空間顯示這一段
      setSheetH(LEG_SHEET_H)
    }
  }

  return (
    <div className="map-page" style={{ "--sheet-h": `${height}px` } as React.CSSProperties}>
      <MapView
        route={displayRoute}
        routes={mapRoutes}
        onRouteClick={(id) => {
          if (cutting != null || entryCard?.drawing) return
          if (id.startsWith('entry:')) {
            const e = (entries ?? []).find((x) => `entry:${x.id}` === id)
            if (e) openEntryRoute(e)
            return
          }
          pickLeg(id === legSel ? null : id)
        }}
        drawMode={(drawing && !!pickedLeg) || (!!entryCard?.drawing && !!cardEntry)}
        onDrawEnd={async (pts) => {
          if (entryCard?.drawing && cardEntry) {
            const e = cardEntry
            setEntryCard({ id: e.id, drawing: false })
            setDrawBusy(true)
            const piece = routeSettings.snap ? await snapDrawn(pts, entryMode) : pts
            // 已經畫過：只換掉畫的那一小段（跟路段的手繪修改一樣）
            const base = entryLine(e, cardNext)
            const line = base ? spliceLine(base, piece, [pts[0], pts[pts.length - 1]]) : piece
            await routeStep(() => setEntryEdit(date, e.id, line))
            setDrawBusy(false)
            toast(!base ? '已畫好路線' : '已修改你畫的那一小段')
            return
          }
          if (!pickedLeg) return
          setDrawing(false)
          setDrawBusy(true)
          const mode = modeOf(pickedLeg).mode
          const piece = routeSettings.snap ? await snapDrawn(pts, mode) : pts
          // 只換掉畫的那一小段（頭尾接回目前的線最近的位置），前後都保留
          const base = legLine(pickedLeg)
          const line = spliceLine(base, piece, [pts[0], pts[pts.length - 1]])
          const leg = pickedLeg
          await routeStep(() => setLegEdit(date, leg.id, line))
          setDrawBusy(false)
          toast('已修改你畫的那一小段')
        }}
        // 對焦只看這段的定位點：手繪修改或貼齊完成時畫面不會跳（一段一段修改時才找得到剛才的位置）
        focus={cardEntry?.location ? [cardEntry.location, ...(cardNext ? [cardNext] : [])] : pickedLeg ? pickedLeg.points : null}
        // 選點切段時先藏起標記，頭尾的點才點得到
        markers={cutting != null ? [] : markers}
        dots={dots}
        onDotClick={onCutPoint}
        selectedId={selected}
        onSelect={(id) => {
          setLegSel(null)
          if (entryCard && entryCard.id !== id) setEntryCard(null)
          setSelected(id)
        }}
        playhead={playhead}
        myLocation={myPos}
        fallbackCenter={lastPos ?? TAIPEI}
        bottomPadding={(pickedLeg || cardEntry ? LEG_SHEET_H : peek) + 56 + (showHist ? 50 : 0)}
        topPadding={pickedLeg ? 300 : cardEntry ? (entryCard?.drawing ? 160 : 230) : 70}
        ariaLabel={`${formatDateLong(date)}的路線地圖`}
      />

      <div className="topbar">
        <div className="date-pill">
          <button className="nav" aria-label="前一天" onClick={() => navigate(`map?d=${shiftDate(date, -1)}`, true)}>
            <Icon name="chevronLeft" size={20} strokeWidth={2.2} />
          </button>
          <button className="label" onClick={() => navigate(`day/${date}`)} aria-label={`${formatDateLong(date)}，查看完整回顧`}>
            <strong>{formatDateLong(date)}</strong>
            <span>{label}</span>
          </button>
          <button
            className="nav"
            aria-label="後一天"
            disabled={isToday}
            onClick={() => navigate(`map?d=${shiftDate(date, 1)}`, true)}
          >
            <Icon name="chevronRight" size={20} strokeWidth={2.2} />
          </button>
        </div>
        <label className="round-btn lg date-input-wrap" aria-label="選擇日期">
          <Icon name="calendar" />
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && navigate(`map?d=${e.target.value}`, true)}
          />
        </label>
      </div>

      {pickedLeg ? (
        <LegCard
          leg={pickedLeg}
          title={legTitle(pickedLeg, legIndex)}
          mode={modeOf(pickedLeg)}
          autoMode={guessMode(pickedLeg, routeSettings.mode)}
          snapOn={routeSettings.snap}
          hasPrev={legIndex > 0}
          hasNext={legIndex < legs.length - 1}
          onPrev={() => pickLeg(legs[legIndex - 1].id)}
          onNext={() => pickLeg(legs[legIndex + 1].id)}
          onClose={() => pickLeg(null)}
          onMode={(m) => routeStep(() => setLegMode(date, pickedLeg.id, m))}
          km={legKm(pickedLeg)}
          edited={!!editOf(pickedLeg)}
          drawing={drawing}
          drawBusy={drawBusy}
          onDraw={() => setDrawing((d) => !d)}
          onRestore={() => routeStep(() => setLegEdit(date, pickedLeg.id, null))}
          cutting={cutting}
          onCut={() => setCutting((c) => (c == null ? 'start' : null))}
          onUncut={pickedLeg.cutStart || pickedLeg.cutEnd ? () => onUncut(pickedLeg) : null}
          hist={histCtl}
        />
      ) : cardEntry && entryCard ? (
        <EntryRouteCard
          title={`${formatTime(cardEntry.time)} ${entryTitle(cardEntry)}`}
          next={cardNext ? anchorLabel(cardNext) : null}
          withLegs={legs.length > 0}
          drawing={entryCard.drawing}
          drawBusy={drawBusy}
          km={(() => {
            const l = entryLine(cardEntry, cardNext)
            return l ? lineKm(l) : null
          })()}
          snapOn={routeSettings.snap}
          mode={entryMode}
          onMode={setEntryMode}
          onAuto={cardNext ? () => autoEntryRoute(cardEntry) : null}
          onDraw={() => setEntryCard({ id: cardEntry.id, drawing: !entryCard.drawing })}
          hist={histCtl}
          onCancelDraw={() => (entryEdits[cardEntry.id] ? setEntryCard({ id: cardEntry.id, drawing: false }) : setEntryCard(null))}
          onDelete={async () => {
            await routeStep(() => setEntryEdit(date, cardEntry.id, null))
            setEntryCard(null)
            toast('已刪除這條手繪路線')
          }}
          onClose={() => {
            setEntryCard(null)
            setSheetH(peek)
          }}
        />
      ) : (
        snapStatus && <div className="snap-chip">{snapStatus}</div>
      )}

      <div className="map-actions" style={{ bottom: `calc(var(--tabbar-h) + ${height + 16}px)` }} hidden={expanded}>
        <button className="checkin-btn" onClick={() => setShowStyles(true)} aria-label="地圖樣式">
          <Icon name="layers" size={18} />
          樣式
        </button>
        {route.length > 1 && (
          <button className="checkin-btn" onClick={play} aria-label={playhead ? '停止播放' : '播放當天行程'}>
            <Icon name={playhead ? 'pause' : 'play'} size={18} />
          </button>
        )}
        <button className="checkin-btn" onClick={locateMe} disabled={checkingIn} aria-label="定位：地圖移到目前位置">
          {checkingIn ? <span className="spinner" /> : <Icon name="locate" size={18} />}
          定位
        </button>
        <button className="fab" aria-label="新增紀錄" onClick={() => navigate(`entry/new?d=${date}`)}>
          <Icon name="plus" size={28} strokeWidth={2.4} />
        </button>
      </div>

      {showHist && (
        <div className="history-bar" style={{ bottom: `calc(var(--tabbar-h) + ${height + 16}px)` }} hidden={expanded}>
          <button aria-label="上一步" disabled={!hist.canUndo || busyDraw} onClick={onUndo}>
            <Icon name="undo" size={18} />
            上一步
          </button>
          <button aria-label="下一步" disabled={!hist.canRedo || busyDraw} onClick={onRedo}>
            <Icon name="redo" size={18} />
            下一步
          </button>
        </div>
      )}

      <section className={`sheet${dragging ? ' dragging' : ''}`} style={{ height }} aria-label="當天紀錄">
        <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <button className="sheet-handle" aria-label={expanded ? '收起面板' : '展開面板'} aria-expanded={expanded} />
          <div className="sheet-head">
            <div>
              <div className="total-label">{isToday ? '今日支出' : '當日支出'}</div>
              <div className="total">{formatTwd(stats.expense)}</div>
            </div>
            <div className="meta">
              <span>
                {stats.places} 個地點 · {displayRoute !== route ? lineKm(displayRoute) : stats.km} km
              </span>
              <span>
                {stats.records} 則紀錄 · {stats.photos} 張照片
              </span>
              {steps && <span>{steps.steps.toLocaleString('en-US')} 步</span>}
              {lastAuto && <span>背景定位 {isCarry(lastAuto) ? formatShort(lastAuto.carriedFrom!) : formatTime(lastAuto.time)}</span>}
              {/* App 版本（建置時間），每次更新後確認有沒有換成新版 */}
              <span>版本 {APP_VERSION}</span>
            </div>
          </div>
        </div>
        <div className="sheet-body" ref={listRef}>
          {routeSettings.rawPoints && rawTrack && rawTrack.some(isAuto) && (
            <button type="button" className="btn-outline" style={{ margin: '8px 16px', width: 'calc(100% - 32px)' }} onClick={copyRawPoints}>
              複製這天的原始定位點（貼給開發者除錯）
            </button>
          )}
          {loaded && items.length === 0 && (
            <div className="sheet-empty">
              {isToday ? '今天還沒有紀錄，按右邊的 + 記一筆' : '這天沒有紀錄'}
            </div>
          )}
          {items.map((item) =>
            item.type === 'leg' ? (
              <button
                key={item.leg.id}
                data-id={item.leg.id}
                className={`row track-row leg-row${legSel === item.leg.id ? ' selected' : ''}`}
                aria-pressed={legSel === item.leg.id}
                onClick={() => pickLeg(legSel === item.leg.id ? null : item.leg.id)}
              >
                <span className="time">{formatTime(item.time)}</span>
                <span className="badge leg">
                  <Icon name="trip" size={18} />
                </span>
                <span className="main">
                  <span className="title">移動 · {legTitle(item.leg, legs.indexOf(item.leg))}</span>
                  <span className="sub">
                    {legKm(item.leg)} km · {formatDuration(item.leg.end - item.leg.start)} · {modeName(modeOf(item.leg).mode)}
                  </span>
                </span>
              </button>
            ) : item.type === 'stay' ? (
              <button
                key={`${item.stay.id}-${item.edge}`}
                data-id={item.edge === 'arrive' ? item.stay.id : undefined}
                className={`row track-row stay-row${selected === item.stay.id ? ' selected' : ''}`}
                onClick={() => setSelected(item.stay.id)}
              >
                <span className="time">{formatTime(item.time)}</span>
                <span className="badge track">
                  <Icon name="pin" size={16} />
                </span>
                <span className="main">
                  <span className="title">
                    {item.edge === 'arrive' ? '抵達' : '離開'} {stayNames[item.stay.id] ?? '…'}
                  </span>
                </span>
              </button>
            ) : item.type === 'track' ? (
              <button
                key={item.point.id}
                data-id={item.point.id}
                className={`row track-row${selected === item.point.id ? ' selected' : ''}`}
                onClick={() => setSelected(item.point.id)}
              >
                <span className="time">{formatTime(item.time)}</span>
                <span className="badge track">
                  <Icon name="locate" size={16} />
                </span>
                <span className="main">
                  <span className="title">定位{item.point.label ? ` · ${item.point.label}` : ''}</span>
                </span>
              </button>
            ) : (
              <EntryRow
                key={item.entry.id}
                entry={item.entry}
                thumb={thumbs[item.entry.id]}
                selected={selected === item.entry.id}
                onSelect={() => {
                  if (!item.entry.location) return navigate(`entry/${item.entry.id}`)
                  if (entryCard && entryCard.id !== item.entry.id) setEntryCard(null)
                  setSelected(item.entry.id)
                }}
                hasRoute={!!entryEdits[item.entry.id]}
                onRoute={item.entry.location ? () => openEntryRoute(item.entry) : undefined}
              />
            ),
          )}
          {loaded && items.length > 0 && (
            <div className="sheet-foot">
              <button className="btn-outline" onClick={() => navigate(`day/${date}`)}>
                查看完整回顧
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
          )}
        </div>
      </section>
      {showStyles && <MapStyleSheet onClose={() => setShowStyles(false)} />}
    </div>
  )
}

function EntryRow({
  entry,
  thumb,
  selected,
  onSelect,
  hasRoute,
  onRoute,
}: {
  entry: Entry
  thumb?: string
  selected: boolean
  onSelect: () => void
  hasRoute: boolean
  onRoute?: () => void
}) {
  const cat = getCategory(entry.categoryId)
  const amt = shortAmount(entry)
  return (
    <div className={`row${selected ? ' selected' : ''}`} data-id={entry.id}>
      <button className="row" style={{ padding: 0, flex: 1, minWidth: 0 }} onClick={onSelect}>
        <span className="time">{formatTime(entry.time)}</span>
        {thumb ? (
          <span className="badge photo">
            <img src={thumb} alt="" />
          </span>
        ) : (
          <span className="badge">
            <Icon name={cat?.icon ?? 'edit'} size={20} />
          </span>
        )}
        <span className="main">
          <span className="title">{entryTitle(entry)}</span>
          <span className="sub">{entrySubtitle(entry)}</span>
        </span>
        {amt && (
          <span className={`amount${entry.kind === 'income' ? ' income' : ''}`}>
            {amt.main}
            {amt.twd && <small>{amt.twd}</small>}
          </span>
        )}
      </button>
      {selected && onRoute && (
        <button className="row-edit" onClick={onRoute}>
          {hasRoute ? '路線' : '畫路線'}
        </button>
      )}
      {selected && (
        <button className="row-edit" onClick={() => navigate(`entry/${entry.id}`)}>
          編輯
        </button>
      )}
    </div>
  )
}

function LegCard({
  leg,
  title,
  mode,
  autoMode,
  snapOn,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onMode,
  km,
  edited,
  drawing,
  drawBusy,
  onDraw,
  onRestore,
  cutting,
  onCut,
  onUncut,
  hist,
}: {
  leg: Leg
  title: string
  mode: { mode: TravelMode; auto: boolean }
  autoMode: TravelMode
  snapOn: boolean
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onMode: (m: TravelMode | null) => void
  km: number
  edited: boolean
  drawing: boolean
  drawBusy: boolean
  onDraw: () => void
  onRestore: () => void
  cutting: null | 'start' | number
  onCut: () => void
  onUncut: (() => void) | null
  hist?: HistCtl
}) {
  const dur = leg.end - leg.start
  // 畫線時卡片縮成一行，讓出地圖空間
  if (drawing)
    return (
      <section className="leg-card leg-card-drawing" aria-label={`手繪修改：${title}`}>
        <p className="leg-draw-hint">只要畫錯的那一小段：從原本的線上開始畫、畫回原本的線上放開，就只換掉中間那段（可以一段一段改）。要放大用兩指縮放。</p>
        <div className="leg-edit">
          <button onClick={onDraw}>取消手繪</button>
        </div>
      </section>
    )
  if (cutting != null)
    return (
      <section className="leg-card leg-card-drawing" aria-label={`切出一段：${title}`}>
        <p className="leg-draw-hint">
          {cutting === 'start'
            ? '點路線上的藍點當起點（這段從哪個點開始）。'
            : `起點 ${formatTime(cutting)}（橘點）。再點一個藍點當終點，中間就切成單獨一段，可以另外選交通方式。`}
        </p>
        <div className="leg-edit">
          <button onClick={onCut}>取消</button>
        </div>
      </section>
    )
  return (
    <section className="leg-card" aria-label={`移動：${title}`}>
      <div className="leg-card-head">
        <strong>{title}</strong>
        <span className="leg-head-btns">
          {hist && <HistoryButtons {...hist} />}
          <button className="leg-all" onClick={onClose}>
            看全天
          </button>
        </span>
      </div>
      <div className="leg-stats">
        <div>
          <span>時間</span>
          <b>
            {formatTime(leg.start)}–{formatTime(leg.end)}
          </b>
        </div>
        <div>
          <span>距離</span>
          <b>{km} km</b>
        </div>
        <div>
          <span>花了</span>
          <b>{formatDuration(dur)}</b>
        </div>
        <div>
          <span>平均</span>
          <b>{Math.round(leg.avgKmh)} km/h</b>
        </div>
      </div>
      <label className="leg-mode">
        <span>交通方式{snapOn ? '' : '（貼齊道路已關閉）'}</span>
        <select value={mode.auto ? '' : mode.mode} onChange={(e) => onMode((e.target.value || null) as TravelMode | null)}>
          <option value="">自動判斷（{modeName(autoMode)}）</option>
          {TRAVEL_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {drawBusy && <p className="leg-draw-hint">貼齊道路中…</p>}
      <div className="leg-edit">
        <button onClick={onDraw} disabled={drawBusy}>
          {edited ? '再修改一段' : '手繪修改路線'}
        </button>
        {edited && (
          <button onClick={onRestore} disabled={drawBusy}>
            還原自動路線
          </button>
        )}
      </div>
      <div className="leg-edit">
        <button onClick={onCut} disabled={drawBusy || leg.points.length < 3}>
          選點切出一段
        </button>
        {onUncut && (
          <button onClick={onUncut} disabled={drawBusy}>
            合併回前後段
          </button>
        )}
      </div>
      <div className="leg-nav">
        <button disabled={!hasPrev} onClick={onPrev}>
          ‹ 上一段
        </button>
        <button disabled={!hasNext} onClick={onNext}>
          下一段 ›
        </button>
      </div>
    </section>
  )
}

function EntryRouteCard({
  title,
  next,
  withLegs,
  drawing,
  drawBusy,
  km,
  snapOn,
  mode,
  onMode,
  onAuto,
  onDraw,
  onCancelDraw,
  onDelete,
  onClose,
  hist,
}: {
  title: string
  next: string | null
  withLegs: boolean
  drawing: boolean
  drawBusy: boolean
  km: number | null
  snapOn: boolean
  mode: TravelMode
  onMode: (m: TravelMode) => void
  onAuto: (() => void) | null
  onDraw: () => void
  onCancelDraw: () => void
  onDelete: () => void
  onClose: () => void
  hist?: HistCtl
}) {
  const where = next ? `畫到下一個地點「${next}」` : withLegs ? '畫到你去的地方（這是當天最後一筆有地點的紀錄）' : '畫到你去的地方（這是當天最後一個地點）'
  if (drawing)
    return (
      <section className="leg-card leg-card-drawing" aria-label={`從記帳點手繪路線：${title}`}>
        <p className="leg-draw-hint">
          從「{title}」的標記開始，用一根手指{where}，放開就好{next ? '，頭尾會自動接上' : ''}。已經畫過的話，只畫錯的那一小段就好。要放大用兩指縮放。
        </p>
        <div className="leg-edit">
          <button onClick={onCancelDraw}>取消手繪</button>
        </div>
      </section>
    )
  return (
    <section className="leg-card" aria-label={`從記帳點出發的路線：${title}`}>
      <div className="leg-card-head">
        <strong>
          {title} → {next ?? '…'}
        </strong>
        <span className="leg-head-btns">
          {hist && <HistoryButtons {...hist} />}
          <button className="leg-all" onClick={onClose}>
            看全天
          </button>
        </span>
      </div>
      <label className="leg-mode">
        <span>{km != null ? `${km} km` : '還沒有路線'} · 交通方式</span>
        <select value={mode} onChange={(e) => onMode(e.target.value as TravelMode)}>
          {TRAVEL_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {drawBusy && <p className="leg-draw-hint">規劃／貼齊道路中…</p>}
      {!snapOn && <p className="leg-draw-hint">貼齊道路已關閉：手繪的線照畫的保留。</p>}
      <div className="leg-edit">
        {onAuto && (
          <button onClick={onAuto} disabled={drawBusy}>
            自動連線
          </button>
        )}
        <button onClick={onDraw} disabled={drawBusy}>
          {km != null ? '再修改一段' : '手繪路線'}
        </button>
        {km != null && (
          <button onClick={onDelete} disabled={drawBusy}>
            刪除
          </button>
        )}
      </div>
    </section>
  )
}

type HistCtl = { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }

/** 卡片標題列上的上一步／下一步（小圖示） */
function HistoryButtons({ canUndo, canRedo, onUndo, onRedo }: HistCtl) {
  return (
    <>
      <button className="leg-all leg-hist" aria-label="上一步" disabled={!canUndo} onClick={onUndo}>
        <Icon name="undo" size={16} />
      </button>
      <button className="leg-all leg-hist" aria-label="下一步" disabled={!canRedo} onClick={onRedo}>
        <Icon name="redo" size={16} />
      </button>
    </>
  )
}
