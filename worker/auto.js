/**
 * 記帳日記：自動化接收端（掛在照片伺服器同一個 Worker 上）
 *
 * 背景定位 App、捷徑、Scriptable 小工具都用「自動化金鑰」（App 設定頁產生）：
 *   Authorization: Bearer <金鑰>    （Overland、捷徑、Scriptable）
 *   或 Basic 認證的密碼、或網址 ?key=<金鑰>（OwnTracks）
 * Worker 不保存任何密碼：它帶著金鑰呼叫 Supabase 的 auto_* 函式（見 supabase/automation.sql），
 * 函式確認金鑰是誰的才寫入／讀出。
 *
 *   POST /auto/overland     Overland 的批次軌跡，回 {"result":"ok"}
 *   POST /auto/owntracks    OwnTracks（HTTP 模式），回 []
 *   POST /auto/location     捷徑：記下目前位置 {lat, lng}
 *   POST /auto/entry        捷徑：快速記一筆 {amount, category, note, lat, lng}
 *   POST /auto/steps        捷徑：今天步數 {steps, distance}
 *   GET  /auto/widget?date=YYYY-MM-DD   Scriptable 小工具要的資料
 *   GET  /auto/photo/<id>   小工具用的照片縮圖
 *   GET  /auto/check        測試金鑰
 */

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } })
const text = (body, status = 200) =>
  new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' } })

class HttpError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

/** 分類名稱 → App 的分類 id（跟 src/lib/categories.ts 一致） */
export const EXPENSE_CATEGORIES = {
  餐飲: 'food',
  交通: 'transport',
  購物: 'shopping',
  住宿: 'lodging',
  門票: 'ticket',
  日用: 'daily',
  娛樂: 'fun',
  帳單: 'bills',
  醫療: 'medical',
  其他: 'other',
}
export const INCOME_CATEGORIES = { 薪水: 'salary', 獎金: 'bonus', 投資: 'invest', 退款: 'refund', 收入: 'other-income' }

// ── 金鑰 ──

export function keyFrom(request, url) {
  const auth = request.headers.get('Authorization') || ''
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim()
  if (/^Basic\s+/i.test(auth)) {
    try {
      const decoded = atob(auth.replace(/^Basic\s+/i, '').trim())
      return decoded.slice(decoded.indexOf(':') + 1).trim()
    } catch {
      return ''
    }
  }
  return (url.searchParams.get('key') || '').trim()
}

async function rpc(env, fn, args) {
  let res
  try {
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
  } catch {
    throw new HttpError('連不上 Supabase', 502)
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const j = await res.json()
      msg = j.message || j.msg || msg
    } catch {
      /* 用狀態碼 */
    }
    if (/金鑰/.test(msg)) throw new HttpError(msg, 401)
    if (res.status === 404 || /could not find the function|schema cache/i.test(msg))
      throw new HttpError('Supabase 還沒執行自動化設定 SQL（App 設定頁 → 自動化 → 複製設定 SQL）', 500)
    throw new HttpError(`Supabase：${msg}`, 502)
  }
  return res.json()
}

const infoCache = new Map()

/** 金鑰 → {user_id, tz}；金鑰不對丟 401 */
async function keyInfo(env, key) {
  if (!key) throw new HttpError('缺少自動化金鑰', 401)
  const hit = infoCache.get(key)
  if (hit && hit.until > Date.now()) return hit.info
  const info = await rpc(env, 'auto_key_info', { p_key: key })
  if (!info || !info.user_id) throw new HttpError('自動化金鑰不對或已重新產生，請到 App 設定頁複製新的', 401)
  if (infoCache.size > 50) infoCache.clear()
  infoCache.set(key, { info, until: Date.now() + 5 * 60 * 1000 })
  return info
}

async function write(env, key, table, rows) {
  let n = 0
  for (let i = 0; i < rows.length; i += 500) n += await rpc(env, 'auto_write', { p_key: key, p_table: table, p_rows: rows.slice(i, i + 500) })
  return n
}

const read = (env, key, table, from, to) => rpc(env, 'auto_read', { p_key: key, p_table: table, p_from: from, p_to: to })

// ── 時間與日期 ──

const pad = (n) => String(n).padStart(2, '0')

/** 「+0800」「+08:00」「Z」→ 分鐘；看不懂回傳 null */
export function offsetMinutes(s) {
  if (s === 'Z' || s === 'z') return 0
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s || '')
  if (!m) return null
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

/** ISO 時間（可能沒有冒號的 +0800）→ {time, offset}；offset 是時間字串自己帶的時區（分鐘） */
export function parseIsoTime(s) {
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s.trim())
  if (!m) return null
  const offset = m[7] ? offsetMinutes(m[7].toUpperCase()) : null
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - (offset ?? 0) * 60000
  return { time: utc, offset }
}

/** 某個時刻在某個時區是哪一天（YYYY-MM-DD） */
export function dateInZone(time, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time))
    const get = (t) => parts.find((p) => p.type === t)?.value
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return dateWithOffset(time, 480)
  }
}

export function dateWithOffset(time, offset) {
  const d = new Date(time + offset * 60000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 數字或「1,234」「1234 步」這種文字 → 數字 */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /-?\d+(?:\.\d+)?/.exec(v.replace(/[,，\s]/g, ''))
  return m ? Number(m[0]) : null
}

const validLatLng = (lat, lng) => lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

function trackRow(p) {
  const id = `auto-${p.time}`
  return { id, updated_at: p.time, data: { id, source: 'auto', ...p } }
}

// ── 背景定位 ──

/** Overland：{locations: [GeoJSON Feature…]} */
export function overlandPoints(body, tz) {
  const out = []
  for (const f of Array.isArray(body?.locations) ? body.locations : []) {
    const c = f?.geometry?.coordinates
    const props = f?.properties || {}
    if (!Array.isArray(c)) continue
    const lng = toNumber(c[0])
    const lat = toNumber(c[1])
    const t = parseIsoTime(props.timestamp)
    if (!t || !validLatLng(lat, lng)) continue
    const acc = toNumber(props.horizontal_accuracy)
    if (acc != null && acc < 0) continue // iOS：負的精確度代表這個點無效
    const p = {
      time: t.time,
      date: t.offset != null ? dateWithOffset(t.time, t.offset) : dateInZone(t.time, tz),
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
    }
    if (acc != null) p.accuracy = Math.round(acc)
    out.push(p)
  }
  return out
}

/** OwnTracks：一次一個 {_type:"location", lat, lon, tst(秒), acc} */
export function owntracksPoints(body, tz) {
  const list = Array.isArray(body) ? body : [body]
  const out = []
  for (const b of list) {
    if (b?._type !== 'location') continue
    const lat = toNumber(b.lat)
    const lng = toNumber(b.lon)
    const tst = toNumber(b.tst)
    if (!tst || !validLatLng(lat, lng)) continue
    const time = tst * 1000
    const p = { time, date: dateInZone(time, tz), lat, lng }
    const acc = toNumber(b.acc)
    if (acc != null) p.accuracy = Math.round(acc)
    out.push(p)
  }
  return out
}

// ── 捷徑 ──

/** 捷徑送來的時間：ISO 文字或沒有（用現在） */
function shortcutTime(v) {
  const t = parseIsoTime(v)
  return t ? t.time : Date.now()
}

export function shortcutEntry(body, tz, now = Date.now()) {
  const amount = toNumber(body.amount)
  const catName = String(body.category ?? '').trim()
  const note = String(body.note ?? '').trim()
  const title = String(body.title ?? '').trim()
  let kind = body.kind === 'income' || INCOME_CATEGORIES[catName] ? 'income' : 'expense'
  // 金額空白 → 日記；填 0 → 0 元的帳（例如免費、招待）
  if (amount == null) {
    if (!note && !title) throw new HttpError('金額和文字都是空的', 400)
    kind = 'diary'
  }
  const categoryId = kind === 'diary' ? null : kind === 'income' ? INCOME_CATEGORIES[catName] || 'other-income' : EXPENSE_CATEGORIES[catName] || 'other'
  const time = body.time ? shortcutTime(body.time) : now
  const lat = toNumber(body.lat)
  const lng = toNumber(body.lng)
  const value = kind === 'diary' ? null : Math.abs(amount)
  const id = `sc-${time}-${Math.random().toString(36).slice(2, 8)}`
  const entry = {
    id,
    kind,
    title,
    amount: value,
    currency: 'TWD',
    rate: 1,
    amountTwd: value,
    categoryId,
    note,
    time,
    date: dateInZone(time, tz),
    location: validLatLng(lat, lng) ? { lat, lng } : null,
    photoIds: [],
    placeId: null,
    createdAt: now,
    updatedAt: now,
    source: 'shortcut',
  }
  return entry
}

// ── 小工具 ──

export function shiftDay(date, days) {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

function oneYearBefore(date) {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y - 1, m - 1, d))
  // 2/29 → 前一年沒有 2/29 時用 2/28
  if (t.getUTCMonth() !== m - 1) return `${y - 1}-${pad(m)}-28`
  return `${y - 1}-${pad(m)}-${pad(d)}`
}

const sum = (list) => Math.round(list.reduce((s, e) => s + (Number(e.amountTwd) || 0), 0) * 100) / 100

/** 路線點太多時平均挑，最多 max 點 */
export function thinRoute(points, max = 150) {
  if (points.length <= max) return points
  const out = []
  const step = (points.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)])
  return out
}

export function buildWidget({ date, entries, track, steps, yearAgo }) {
  const today = entries.filter((e) => e.date === date)
  const expense = (list) => list.filter((e) => e.kind === 'expense')
  const route = thinRoute(
    [
      ...track.filter((p) => p.accuracy == null || p.accuracy <= 200).map((p) => ({ time: p.time, lat: p.lat, lng: p.lng })),
      ...today.filter((e) => e.location).map((e) => ({ time: e.time, lat: e.location.lat, lng: e.location.lng })),
    ].sort((a, b) => a.time - b.time),
  ).map((p) => [Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5])
  const named = today.filter((e) => e.location?.name || e.title).sort((a, b) => b.time - a.time)[0]
  const lastPoint = [...track, ...today.filter((e) => e.location)].sort((a, b) => b.time - a.time)[0]
  const yaEntries = yearAgo.entries.sort((a, b) => a.time - b.time)
  return {
    date,
    todayExpense: sum(expense(today)),
    todayCount: today.length,
    monthExpense: sum(expense(entries)),
    steps: steps ? Number(steps.steps) || 0 : null,
    lastPlace: named ? { name: named.title || named.location?.name || '', time: named.time } : null,
    lastTime: lastPoint ? lastPoint.time : null,
    route,
    yearAgo: {
      date: yearAgo.date,
      summary: yearAgo.summary?.text || '',
      mood: yearAgo.summary?.mood || null,
      expense: sum(expense(yaEntries)),
      count: yaEntries.length,
      notes: yaEntries
        .filter((e) => e.note || e.title)
        .slice(0, 3)
        .map((e) => ({ time: e.time, title: e.title || e.location?.name || '', note: (e.note || '').split('\n')[0].slice(0, 80) })),
      photoId: yaEntries.flatMap((e) => e.photoIds || [])[0] || null,
    },
  }
}

async function readBody(request) {
  const raw = await request.text()
  if (!raw.trim()) return null
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError('內容不是 JSON', 400)
  }
}

// ── 路由 ──

export async function handleAuto(request, env, url) {
  const path = url.pathname.replace(/^\/auto\/?/, '')
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) throw new HttpError('Worker 沒有設定 SUPABASE_URL／SUPABASE_KEY', 500)
    const key = keyFrom(request, url)

    if (request.method === 'POST' && path === 'overland') {
      const info = await keyInfo(env, key)
      const body = await readBody(request)
      const pts = overlandPoints(body, info.tz)
      await write(env, key, 'track_points', pts.map(trackRow))
      return json({ result: 'ok', saved: pts.length })
    }

    if (request.method === 'POST' && path === 'owntracks') {
      const info = await keyInfo(env, key)
      const body = await readBody(request)
      if (body) await write(env, key, 'track_points', owntracksPoints(body, info.tz).map(trackRow))
      return json([])
    }

    if (request.method === 'POST' && path === 'location') {
      const info = await keyInfo(env, key)
      const body = (await readBody(request)) || {}
      const lat = toNumber(body.lat)
      const lng = toNumber(body.lng)
      if (!validLatLng(lat, lng)) throw new HttpError('沒有收到位置（lat、lng）', 400)
      const time = shortcutTime(body.time)
      const p = { time, date: dateInZone(time, info.tz), lat, lng }
      const acc = toNumber(body.accuracy)
      if (acc != null) p.accuracy = Math.round(acc)
      await write(env, key, 'track_points', [trackRow(p)])
      return text('已記下位置')
    }

    if (request.method === 'POST' && path === 'entry') {
      const info = await keyInfo(env, key)
      const body = await readBody(request)
      if (!body || typeof body !== 'object') throw new HttpError('沒有收到內容', 400)
      const e = shortcutEntry(body, info.tz)
      await write(env, key, 'entries', [{ id: e.id, updated_at: e.updatedAt, data: e }])
      const what = e.kind === 'diary' ? '日記' : `${e.kind === 'income' ? '收入' : '支出'} ${e.amount} 元`
      return text(`已記下${what}`)
    }

    if (request.method === 'POST' && path === 'steps') {
      const info = await keyInfo(env, key)
      const body = (await readBody(request)) || {}
      const steps = toNumber(body.steps)
      if (steps == null) throw new HttpError('沒有收到步數（steps）', 400)
      const time = shortcutTime(body.time)
      // date 可以是 YYYY-MM-DD、yesterday（昨天）或不填（今天）：手機鎖定時讀不到健康資料，隔天解鎖時補記昨天
      const today = dateInZone(time, info.tz)
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : /^(yesterday|昨天)$/i.test(String(body.date || '').trim()) ? shiftDay(today, -1) : today
      const now = Date.now()
      const data = { date, steps: Math.round(steps), updatedAt: now }
      const km = toNumber(body.distance)
      if (km != null) data.distanceKm = Math.round(km * 100) / 100
      await write(env, key, 'daily_steps', [{ id: date, updated_at: now, data }])
      return text(`已記下 ${date} 步數 ${data.steps}`)
    }

    if (request.method === 'GET' && path === 'check') {
      const info = await keyInfo(env, key)
      return text(`ok（時區 ${info.tz}）`)
    }

    if (request.method === 'GET' && path === 'widget') {
      const info = await keyInfo(env, key)
      let date = url.searchParams.get('date') || ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = dateInZone(Date.now(), info.tz)
      const ya = oneYearBefore(date)
      const [entries, track, steps, yaEntries, yaSummary] = await Promise.all([
        read(env, key, 'entries', date.slice(0, 8) + '01', date),
        read(env, key, 'track_points', date, date),
        read(env, key, 'daily_steps', date, date),
        read(env, key, 'entries', ya, ya),
        read(env, key, 'summaries', ya, ya),
      ])
      return json(buildWidget({ date, entries, track, steps: steps[0], yearAgo: { date: ya, entries: yaEntries, summary: yaSummary[0] } }))
    }

    const pm = /^photo\/([A-Za-z0-9-]{1,64})$/.exec(path)
    if (request.method === 'GET' && pm) {
      const info = await keyInfo(env, key)
      if (!env.PHOTOS) throw new HttpError('Worker 沒有 R2 綁定', 500)
      const obj = await env.PHOTOS.get(`${info.user_id}/${pm[1]}/thumb`)
      if (!obj) return text('找不到', 404)
      return new Response(obj.body, { headers: { ...CORS, 'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
    }

    return text('找不到', 404)
  } catch (e) {
    if (e instanceof HttpError) {
      // Overland 只看回應內容是不是 {"result":"ok"}；其他回應都會保留資料下次重送
      return path === 'overland' ? json({ result: 'error', error: e.message }, e.status) : text(e.message, e.status)
    }
    return text(`發生錯誤：${e?.message || e}`, 500)
  }
}
