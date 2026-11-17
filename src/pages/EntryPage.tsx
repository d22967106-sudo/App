import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { PhotoImg, toast } from '../components/ui'
import { categoriesFor, defaultCategory } from '../lib/categories'
import { COUNTRY_NAME, CURRENCIES, currencyForCountry, currencyInfo, formatNumber, formatTwd, toTwd } from '../lib/currency'
import { deleteEntry, getEntry, getMeta, newId, saveEntry, setMeta } from '../lib/db'
import { getCurrentPosition } from '../lib/geo'
import { reverseGeocode, searchShops, type NearbyShop } from '../lib/geocode'
import { goBack, navigate } from '../lib/hooks'
import {
  formatDateTimeShort,
  formatTime,
  fromDateTimeLocal,
  isDateKey,
  parseAmount,
  relativeDayLabel,
  toDateKey,
} from '../lib/ledger'
import { processPhoto } from '../lib/photos'
import { commonAmount, rememberPlace, suggestPlaces, type PlaceSuggestion } from '../lib/places'
import { getRate } from '../lib/rates'
import type { Entry, EntryKind, EntryLocation, Photo } from '../lib/types'

type LocState = 'idle' | 'locating' | 'done' | 'error'

const HOUR = 3600_000
const QUICK_TIMES: { label: string; at: () => number }[] = [
  { label: '現在', at: () => Date.now() },
  { label: '1 小時前', at: () => Date.now() - HOUR },
  { label: '3 小時前', at: () => Date.now() - 3 * HOUR },
  { label: '昨天', at: () => Date.now() - 24 * HOUR },
]

const KIND_LABEL: Record<EntryKind, string> = { expense: '支出', income: '收入', diary: '只寫日記' }

interface Props {
  /** 編輯時的紀錄 id；新增時為 null */
  id: string | null
  /** 新增時預設的日期 */
  date: string | null
}

/** 新增時的預設時間：今天用現在時間，其他天用中午 */
function defaultTime(date: string | null): number {
  const today = toDateKey(new Date())
  if (!date || !isDateKey(date) || date === today) return Date.now()
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0).getTime()
}

export function EntryPage({ id, date }: Props) {
  const isNew = id == null
  const [loaded, setLoaded] = useState(isNew)
  const [original, setOriginal] = useState<Entry | null>(null)
  const entryId = useRef(id ?? newId()).current

  const [kind, setKind] = useState<EntryKind>('expense')
  const [amountText, setAmountText] = useState('')
  const [currency, setCurrency] = useState('TWD')
  const [rate, setRate] = useState(1)
  const [rateText, setRateText] = useState('1')
  const [rateInfo, setRateInfo] = useState<'auto' | 'manual' | 'missing' | 'loading'>('auto')
  const [currencyHint, setCurrencyHint] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>('food')
  const [title, setTitle] = useState('')
  const [placeId, setPlaceId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [time, setTime] = useState(() => defaultTime(date))
  const [location, setLocation] = useState<EntryLocation | null>(null)
  const [locState, setLocState] = useState<LocState>('idle')
  const [locError, setLocError] = useState('')
  const [photoIds, setPhotoIds] = useState<string[]>([])
  const [newPhotos, setNewPhotos] = useState<Photo[]>([])
  const [processing, setProcessing] = useState(0)
  const [remembered, setRemembered] = useState<PlaceSuggestion[]>([])
  /** 從清單點選的店名（點選後不再拿來篩選） */
  const [pickedName, setPickedName] = useState<string | null>(null)
  /** 打字搜尋的結果：query 是搜尋時的文字 */
  const [search, setSearch] = useState<SearchState | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // 使用者動過的欄位，自動帶入時不要覆蓋
  const touched = useRef({ currency: false, category: false, amount: false, title: false })

  // ── 載入（編輯）或開始定位（新增） ──
  useEffect(() => {
    if (isNew) {
      getMeta<string>('lastCurrency').then((c) => {
        if (c && c !== 'TWD' && !touched.current.currency) changeCurrency(c, false)
      })
      locate()
      return
    }
    getEntry(id!).then((e) => {
      if (!e) {
        toast('找不到這筆紀錄')
        navigate('map', true)
        return
      }
      setOriginal(e)
      setKind(e.kind)
      setAmountText(e.amount != null ? String(e.amount) : '')
      setCurrency(e.currency)
      setRate(e.rate)
      setRateText(String(e.rate))
      setRateInfo('manual')
      setCategoryId(e.categoryId)
      setTitle(e.title)
      setPickedName(e.title)
      setPlaceId(e.placeId)
      setNote(e.note)
      setTime(e.time)
      setLocation(e.location)
      setLocState(e.location ? 'done' : 'idle')
      setPhotoIds(e.photoIds)
      touched.current = { currency: true, category: true, amount: true, title: true }
      setLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ── 定位、地名、附近店家 ──
  const locateSeq = useRef(0)
  async function locate() {
    const seq = ++locateSeq.current
    setLocState('locating')
    setLocError('')
    try {
      const pos = await getCurrentPosition()
      if (seq !== locateSeq.current) return
      const loc: EntryLocation = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }
      setLocation(loc)
      setLocState('done')
      setMeta('lastPos', { lat: pos.lat, lng: pos.lng })
      suggestPlaces(loc).then((r) => seq === locateSeq.current && setRemembered(r))
      const geo = await reverseGeocode(loc)
      if (seq !== locateSeq.current || !geo) return
      setLocation((cur) => (cur ? { ...cur, name: geo.name, countryCode: geo.countryCode } : cur))
      // 人在國外時自動建議當地幣別
      const local = currencyForCountry(geo.countryCode)
      if (local && isNew && !touched.current.currency) {
        changeCurrency(local, false)
        if (local !== 'TWD') {
          const country = COUNTRY_NAME[geo.countryCode ?? ''] ?? '國外'
          setCurrencyHint(`偵測到你在${country}，已自動切成${currencyInfo(local).name}`)
        } else {
          setCurrencyHint('')
        }
      }
    } catch (e) {
      if (seq !== locateSeq.current) return
      setLocState('error')
      setLocError((e as Error).message)
    }
  }

  // ── 幣別與匯率 ──
  async function changeCurrency(code: string, byUser: boolean) {
    if (byUser) {
      touched.current.currency = true
      setCurrencyHint('')
    }
    setCurrency(code)
    if (code === 'TWD') {
      setRate(1)
      setRateText('1')
      setRateInfo('auto')
      return
    }
    setRateInfo('loading')
    const r = await getRate(code)
    if (r) {
      setRate(r.rate)
      setRateText(String(r.rate))
      setRateInfo('auto')
    } else {
      setRateInfo('missing')
      setRateText('')
    }
  }

  const amount = parseAmount(amountText)
  const amountTwd = amount != null && rate > 0 ? toTwd(amount, rate) : null
  const info = currencyInfo(currency)
  const cats = categoriesFor(kind)

  function changeKind(k: EntryKind) {
    setKind(k)
    if (k !== 'diary' && !cats.some((c) => c.id === categoryId)) {
      setCategoryId(defaultCategory(k))
    }
  }

  // ── 店名建議 ──
  function pickRemembered(s: PlaceSuggestion) {
    const p = s.place
    setTitle(p.name)
    setPickedName(p.name)
    touched.current.title = true
    setPlaceId(p.id)
    if (p.categoryId && kind !== 'diary') setCategoryId(p.categoryId)
    if (!amountText && kind !== 'diary') {
      const a = commonAmount(p.recentAmounts)
      if (a != null && p.currency === currency) setAmountText(String(a))
    }
  }

  function pickShop(s: NearbyShop) {
    setTitle(s.name)
    setPickedName(s.name)
    touched.current.title = true
    setPlaceId(null)
    if (s.categoryId && kind === 'expense' && !touched.current.category) setCategoryId(s.categoryId)
    // 用店家座標（回家才記帳時，地點也會是店，不是家裡）
    const seq = ++locateSeq.current
    setLocState('done')
    setLocation((cur) => ({ lat: s.lat, lng: s.lng, countryCode: cur?.countryCode }))
    reverseGeocode(s).then((geo) => {
      if (seq !== locateSeq.current || !geo) return
      setLocation((cur) => (cur ? { ...cur, name: geo.name, countryCode: geo.countryCode } : cur))
    })
  }

  async function runSearch() {
    const q = title.trim()
    if (!q || !location) return
    setSearch({ query: q, state: 'loading', shops: [] })
    const r = await searchShops(location, q)
    setSearch((cur) =>
      cur?.query === q ? { query: q, state: r.ok ? 'ok' : 'error', shops: r.shops, errors: r.errors ?? [] } : cur,
    )
  }

  // 店名欄有字、而且不是剛從清單點選的 → 用來篩選附近店家
  const filterText = title !== pickedName ? title.trim().toLowerCase() : ''
  const searching = search && (search.query === title.trim() || title === pickedName) ? search : null

  const rememberedChips = useMemo(
    () => (filterText ? remembered.filter((r) => r.place.name.toLowerCase().includes(filterText)) : remembered),
    [remembered, filterText],
  )

  const shopChips = useMemo(() => {
    const names = new Set(remembered.map((r) => r.place.name))
    return (searching?.shops ?? []).filter((s) => !names.has(s.name)).slice(0, 20)
  }, [remembered, searching])

  // ── 照片 ──
  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    const list = Array.from(files)
    setProcessing((n) => n + list.length)
    for (const f of list) {
      try {
        const p = await processPhoto(f, entryId)
        setNewPhotos((cur) => [...cur, p])
        setPhotoIds((cur) => [...cur, p.id])
      } catch (e) {
        toast((e as Error).message)
      } finally {
        setProcessing((n) => n - 1)
      }
    }
  }

  function removePhoto(pid: string) {
    setPhotoIds((cur) => cur.filter((x) => x !== pid))
    setNewPhotos((cur) => cur.filter((p) => p.id !== pid))
  }

  // ── 儲存／刪除 ──
  async function save() {
    setError('')
    if (kind !== 'diary' && amount == null) {
      setError('請輸入金額')
      return
    }
    if (kind !== 'diary' && !(rate > 0)) {
      setError('請輸入匯率')
      return
    }
    if (kind === 'diary' && !note.trim() && !photoIds.length && !title.trim()) {
      setError('寫點日記或加張照片吧')
      return
    }
    if (processing > 0) {
      setError('照片還在處理中，請稍等')
      return
    }
    setSaving(true)
    try {
      const now = Date.now()
      const entry: Entry = {
        id: entryId,
        kind,
        title: title.trim(),
        amount: kind === 'diary' ? null : amount,
        currency,
        rate: kind === 'diary' ? 1 : rate,
        amountTwd: kind === 'diary' ? null : amountTwd,
        categoryId: kind === 'diary' ? null : categoryId,
        note: note.trim(),
        time,
        date: toDateKey(time),
        location,
        photoIds,
        placeId,
        createdAt: original?.createdAt ?? now,
        updatedAt: now,
      }
      entry.placeId = await rememberPlace(entry)
      await saveEntry(
        entry,
        newPhotos.filter((p) => photoIds.includes(p.id)),
      )
      if (kind !== 'diary') await setMeta('lastCurrency', currency)
      toast(isNew ? '已儲存' : '已更新')
      navigate(`map?d=${entry.date}`, true)
    } catch (e) {
      console.error(e)
      setError('儲存失敗：' + (e as Error).message)
      setSaving(false)
    }
  }

  async function remove() {
    if (!original) return
    if (!confirm('確定要刪除這筆紀錄嗎？照片也會一起刪除。')) return
    await deleteEntry(original.id)
    toast('已刪除')
    navigate(`map?d=${original.date}`, true)
  }

  if (!loaded) return <div className="entry-page" />

  const tripLabel = relativeDayLabel(toDateKey(time))

  return (
    <div className="entry-page">
      <div className="entry-head">
        <button className="btn-text" onClick={() => goBack(`map?d=${date ?? ''}`)}>
          取消
        </button>
        <h1>{isNew ? '新增紀錄' : '編輯紀錄'}</h1>
        <button className="btn-primary" onClick={save} disabled={saving}>
          儲存
        </button>
      </div>

      <div className="segmented" role="group" aria-label="紀錄類型">
        {(['expense', 'income', 'diary'] as EntryKind[]).map((k) => (
          <button key={k} aria-pressed={kind === k} onClick={() => changeKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {kind !== 'diary' && (
        <div className="amount-block">
          <div className="amount-line">
            <label className="currency-select">
              <span className="sr-only">幣別</span>
              {currency}
              <Icon name="chevronDown" size={14} strokeWidth={2.4} />
              <select value={currency} onChange={(e) => changeCurrency(e.target.value, true)} aria-label={`幣別，目前${info.name}`}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="amount-input">
              <span className="sym" aria-hidden="true">
                {info.symbol}
              </span>
              <input
                inputMode="decimal"
                enterKeyHint="done"
                placeholder="0"
                aria-label="金額"
                value={amountText}
                autoFocus={isNew}
                onChange={(e) => {
                  touched.current.amount = true
                  setAmountText(e.target.value.replace(/[^\d.,]/g, ''))
                }}
                style={{ width: `${Math.max(3, amountText.length + 1)}ch` }}
              />
            </label>
          </div>
          {currency !== 'TWD' && (
            <div className="rate-line">
              <span>≈ {amountTwd != null ? formatTwd(amountTwd) : 'NT$—'}</span>
              <span>·</span>
              <label>
                匯率{' '}
                <input
                  inputMode="decimal"
                  value={rateText}
                  aria-label={`匯率：1 ${currency} 等於多少新台幣`}
                  placeholder="?"
                  onChange={(e) => {
                    setRateText(e.target.value)
                    const v = Number(e.target.value)
                    setRate(v > 0 ? v : 0)
                    setRateInfo('manual')
                  }}
                />
              </label>
              <span>
                {rateInfo === 'loading'
                  ? '（抓取中…）'
                  : rateInfo === 'missing'
                    ? '（抓不到匯率，請手動輸入）'
                    : rateInfo === 'auto'
                      ? '（自動帶入，可修改）'
                      : ''}
              </span>
            </div>
          )}
          {currencyHint && <span className="hint">{currencyHint}</span>}
        </div>
      )}

      {kind !== 'diary' && (
        <div className="field">
          <span className="label" id="cat-label">
            分類
          </span>
          <div className="cat-grid" role="group" aria-labelledby="cat-label">
            {cats.map((c) => (
              <button
                key={c.id}
                aria-pressed={categoryId === c.id}
                onClick={() => {
                  touched.current.category = true
                  setCategoryId(c.id)
                }}
              >
                <Icon name={c.icon} size={22} />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="title">{kind === 'diary' ? '標題' : '店名'}</label>
        <div className="title-row">
          <input
            id="title"
            className="text-input"
            placeholder={kind === 'diary' ? '可不填' : '輸入或從下面選'}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setPlaceId(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch()
              }
            }}
            enterKeyHint="search"
            autoComplete="off"
          />
          {location && title.trim() && (
            <button className="search-btn" onClick={runSearch} aria-label={`搜尋附近叫「${title.trim()}」的店`}>
              <Icon name="search" size={18} />
            </button>
          )}
        </div>
        {(rememberedChips.length > 0 || shopChips.length > 0) && (
          <div className="suggestions" aria-label="附近店家">
            {rememberedChips.map((s) => (
              <button key={s.place.id} className="remembered" onClick={() => pickRemembered(s)}>
                {s.place.name}
                <small>去過 {s.place.visits} 次</small>
              </button>
            ))}
            {shopChips.map((s) => (
              <button key={s.osmId} onClick={() => pickShop(s)}>
                {s.name}
                <small>
                  {s.kindLabel ? `${s.kindLabel} · ` : ''}
                  {s.distance >= 1000 ? `${(s.distance / 1000).toFixed(1)}km` : `${s.distance}m`}
                </small>
              </button>
            ))}
          </div>
        )}
        <ShopStatus
          hasLocation={locState === 'done' && !!location}
          filterText={filterText}
          search={searching}
          onSearch={runSearch}
        />
      </div>

      <div className="field">
        <label htmlFor="diary">日記</label>
        <textarea
          id="diary"
          rows={4}
          placeholder={kind === 'diary' ? '想記下什麼？' : '花這筆錢時的心情（可不填）'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="photo-row">
        {photoIds.map((pid) => {
          const fresh = newPhotos.find((p) => p.id === pid)
          return (
            <div key={pid} className="photo-thumb">
              {fresh ? <FreshThumb photo={fresh} /> : <PhotoImg id={pid} />}
              <button className="remove" aria-label="移除這張照片" onClick={() => removePhoto(pid)}>
                <Icon name="close" size={14} strokeWidth={2.6} />
              </button>
            </div>
          )
        })}
        {Array.from({ length: processing }, (_, i) => (
          <div key={`p${i}`} className="photo-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="spinner" aria-label="照片處理中" />
          </div>
        ))}
        <label className="photo-add">
          <Icon name="camera" size={22} />
          照片
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="加入照片"
            onChange={(e) => {
              addPhotos(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      <div className="field">
        <span className="label" id="time-label">
          時間 <span className="muted" style={{ fontWeight: 400 }}>{tripLabel || formatDateTimeShort(time).split(' ')[0]}</span>
        </span>
        <div className="time-row" role="group" aria-labelledby="time-label">
          <input
            type="date"
            className="text-input"
            aria-label="日期"
            value={toDateKey(time)}
            onChange={(e) => {
              const t = fromDateTimeLocal(`${e.target.value}T${formatTime(time)}`)
              if (t != null) setTime(t)
            }}
          />
          <input
            type="time"
            className="text-input"
            aria-label="時間"
            value={formatTime(time)}
            onChange={(e) => {
              const t = fromDateTimeLocal(`${toDateKey(time)}T${e.target.value}`)
              if (t != null) setTime(t)
            }}
          />
        </div>
        <div className="quick-times">
          {QUICK_TIMES.map((q) => (
            <button key={q.label} onClick={() => setTime(q.at())}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="info-list">
        <button className="info-row" onClick={locate} disabled={locState === 'locating'}>
          <Icon name="pin" size={20} />
          <span>
            {locState === 'locating'
              ? '定位中…'
              : location
                ? (location.name ?? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`)
                : locState === 'error'
                  ? locError
                  : '沒有地點'}
          </span>
          {locState === 'locating' ? (
            <span className="spinner" />
          ) : (
            <span className="aside">{location ? (isNew ? '自動定位 · 重新定位' : '重新定位') : '點一下定位'}</span>
          )}
        </button>
        {location && (
          <button
            className="info-row"
            onClick={() => {
              locateSeq.current++
              setLocation(null)
              setLocState('idle')
              setSearch(null)
              setRemembered([])
            }}
          >
            <Icon name="close" size={20} />
            <span>不附地點</span>
          </button>
        )}
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {!isNew && (
        <button className="btn-outline btn-danger" onClick={remove}>
          <Icon name="trash" size={18} />
          刪除這筆紀錄
        </button>
      )}

      {kind !== 'diary' && amount != null && currency === 'TWD' && (
        <span className="sr-only" aria-live="polite">
          金額 {formatNumber(amount)} 元
        </span>
      )}
    </div>
  )
}

interface SearchState {
  query: string
  state: 'loading' | 'ok' | 'error'
  shops: NearbyShop[]
  errors?: string[]
}

/** 失敗原因小字：使用者截圖回報時看得出是哪個服務出問題 */
function ErrorDetail({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null
  return <small className="error-detail">{errors.join('、')}</small>
}

function ShopStatus({
  hasLocation,
  filterText,
  search,
  onSearch,
}: {
  hasLocation: boolean
  filterText: string
  search: SearchState | null
  onSearch: () => void
}) {
  let content: React.ReactNode = null
  if (search) {
    if (search.state === 'loading')
      content = (
        <>
          <span className="spinner" />
          搜尋「{search.query}」中…
        </>
      )
    else if (search.state === 'error')
      content = (
        <>
          搜尋失敗（網路或服務忙碌）
          <button className="link-btn" onClick={onSearch}>
            重試
          </button>
          <ErrorDetail errors={search.errors} />
        </>
      )
    else if (!search.shops.length) content = <>附近 30 公里內找不到「{search.query}」，直接用你輸入的店名即可</>
    else content = <>符合「{search.query}」的店家（近的在前）</>
  } else if (filterText && hasLocation) {
    content = (
      <>
        想找店家？
        <button className="link-btn" onClick={onSearch}>
          搜尋店名
        </button>
      </>
    )
  }
  if (!content) return null
  return (
    <div className="shop-status" aria-live="polite">
      {content}
    </div>
  )
}

function FreshThumb({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(photo.thumb)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])
  return url ? <img src={url} alt="" /> : null
}
