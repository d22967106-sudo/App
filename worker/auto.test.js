import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWidget, dateInZone, overlandPoints, owntracksPoints, parseIsoTime, shortcutEntry, thinRoute, toNumber } from './auto.js'
import worker from './photos.js'

/** 假的 Supabase auto_* 函式，行為照 supabase/automation.sql */
class FakeSupabase {
  keys = new Map([['good-key', { user_id: 'u1', tz: 'Asia/Taipei' }]])
  tables = { track_points: new Map(), entries: new Map(), daily_steps: new Map(), summaries: new Map() }
  calls = []

  fetch = async (input, init = {}) => {
    const url = new URL(input)
    const fn = url.pathname.replace('/rest/v1/rpc/', '')
    const a = JSON.parse(init.body)
    this.calls.push(fn)
    const res = (b, status = 200) => new Response(JSON.stringify(b), { status })
    const info = this.keys.get(a.p_key)
    if (fn === 'auto_key_info') return res(info ?? null)
    if (!info) return res({ message: '自動化金鑰不對或已重新產生' }, 403)
    if (fn === 'auto_write') {
      const t = this.tables[a.p_table]
      if (!t || a.p_table === 'summaries') return res({ message: `不支援的資料表 ${a.p_table}` }, 400)
      let n = 0
      for (const r of a.p_rows) {
        const old = t.get(r.id)
        if (a.p_table === 'daily_steps') {
          if (old && (r.data.steps ?? 0) < (old.steps ?? 0)) continue
        } else if (old) continue
        t.set(r.id, r.data)
        n++
      }
      return res(n)
    }
    if (fn === 'auto_read') {
      const t = this.tables[a.p_table]
      const byId = a.p_table === 'summaries' || a.p_table === 'daily_steps'
      const out = [...t.entries()].filter(([id, d]) => {
        const k = byId ? id : d.date
        return k >= a.p_from && k <= a.p_to
      })
      return res(out.map(([, d]) => d))
    }
    return res({ message: 'Could not find the function' }, 404)
  }
}

const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_KEY: 'sb_publishable_x', PHOTOS: null }
let sb
beforeEach(() => {
  sb = new FakeSupabase()
  vi.stubGlobal('fetch', sb.fetch)
})
afterEach(() => vi.unstubAllGlobals())

const call = (path, { method = 'POST', body, key = 'good-key', headers = {} } = {}) =>
  worker.fetch(
    new Request(`https://w.example${path}`, {
      method,
      headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )

describe('時間與數字', () => {
  it('看得懂 Overland 沒有冒號的時區', () => {
    const t = parseIsoTime('2026-11-18T08:00:00-0700')
    expect(t.offset).toBe(-420)
    expect(new Date(t.time).toISOString()).toBe('2026-11-18T15:00:00.000Z')
    expect(parseIsoTime('2026-11-18T23:30:00+08:00').time).toBe(Date.UTC(2026, 10, 18, 15, 30))
    expect(parseIsoTime('昨天')).toBeNull()
  })
  it('依時區算日期', () => {
    const t = Date.UTC(2026, 10, 18, 17, 0) // 台灣 11/19 01:00
    expect(dateInZone(t, 'Asia/Taipei')).toBe('2026-11-19')
    expect(dateInZone(t, 'Europe/London')).toBe('2026-11-18')
  })
  it('捷徑送來的文字數字', () => {
    expect(toNumber('1,234')).toBe(1234)
    expect(toNumber('8231 步')).toBe(8231)
    expect(toNumber('3.5')).toBe(3.5)
    expect(toNumber('')).toBeNull()
  })
})

describe('背景定位格式', () => {
  it('Overland：座標是 [經度, 緯度]，日期照時間字串的時區', () => {
    const pts = overlandPoints(
      {
        locations: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [120.449, 23.48] }, properties: { timestamp: '2026-11-18T23:50:00+0800', horizontal_accuracy: 12.4 } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [120.449, 23.48] }, properties: { timestamp: '2026-11-19T00:10:00+0800', horizontal_accuracy: -1 } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { timestamp: '2026-11-19T00:10:00+0800' } },
          { bad: true },
        ],
      },
      'Asia/Taipei',
    )
    expect(pts).toEqual([{ time: Date.UTC(2026, 10, 18, 15, 50), date: '2026-11-18', lat: 23.48, lng: 120.449, accuracy: 12 }])
  })
  it('Overland：時間是 epoch 數字也看得懂；全部看不懂時不回 ok（資料留在手機）', async () => {
    expect(overlandPoints({ locations: [{ geometry: { coordinates: [120.4, 23.5] }, properties: { timestamp: 1795000000 } }] }, 'Asia/Taipei')[0].time).toBe(1795000000000)
    const r = await call('/auto/overland', { body: { locations: [{ geometry: { coordinates: [120.4, 23.5] }, properties: { timestamp: '下午4:20' } }] } })
    expect(r.status).toBe(422)
    expect((await r.json()).result).not.toBe('ok')
  })

  it('OwnTracks：tst 是秒', () => {
    expect(owntracksPoints({ _type: 'location', lat: 23.5, lon: 120.4, tst: 1795000000, acc: 8, tid: 'me' }, 'Asia/Taipei')).toEqual([
      { time: 1795000000000, date: dateInZone(1795000000000, 'Asia/Taipei'), lat: 23.5, lng: 120.4, accuracy: 8 },
    ])
    expect(owntracksPoints({ _type: 'transition' }, 'Asia/Taipei')).toEqual([])
  })
})

describe('接收端', () => {
  const feature = (ts) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [120.44, 23.47] }, properties: { timestamp: ts, horizontal_accuracy: 10 } })

  it('Overland 收到後回 {"result":"ok"}，重送不會重複', async () => {
    const body = { locations: [feature('2026-11-18T10:00:00+0800'), feature('2026-11-18T10:01:00+0800')] }
    const r1 = await call('/auto/overland', { body })
    expect(await r1.json()).toEqual({ result: 'ok', saved: 2 })
    await call('/auto/overland', { body })
    expect(sb.tables.track_points.size).toBe(2)
    const p = sb.tables.track_points.get(`auto-${Date.UTC(2026, 10, 18, 2, 0)}`)
    expect(p).toMatchObject({ source: 'auto', date: '2026-11-18', accuracy: 10 })
  })

  it('金鑰不對：Overland 收到的不是 ok（資料會留在手機下次重送）', async () => {
    const r = await call('/auto/overland', { body: { locations: [feature('2026-11-18T10:00:00+0800')] }, key: 'nope' })
    expect(r.status).toBe(401)
    expect((await r.json()).result).not.toBe('ok')
    const r2 = await call('/auto/check', { method: 'GET', key: '' })
    expect(r2.status).toBe(401)
  })

  it('OwnTracks 用 Basic 認證的密碼或 ?key=', async () => {
    const r = await call('/auto/owntracks', {
      key: '',
      headers: { Authorization: 'Basic ' + btoa('me:good-key') },
      body: { _type: 'location', lat: 23.5, lon: 120.4, tst: 1795000000, tid: 'me' },
    })
    expect(await r.json()).toEqual([])
    await call('/auto/owntracks?key=good-key', { key: '', body: { _type: 'location', lat: 23.6, lon: 120.4, tst: 1795000100, tid: 'me' } })
    expect(sb.tables.track_points.size).toBe(2)
  })

  it('捷徑：快速記一筆', async () => {
    const r = await call('/auto/entry', { body: { amount: '1,250', category: '交通', note: '高鐵', lat: 23.47, lng: 120.44 } })
    expect(await r.text()).toBe('已記下支出 1250 元')
    const [e] = [...sb.tables.entries.values()]
    expect(e).toMatchObject({ kind: 'expense', amount: 1250, amountTwd: 1250, currency: 'TWD', rate: 1, categoryId: 'transport', note: '高鐵', location: { lat: 23.47, lng: 120.44 }, source: 'shortcut', photoIds: [] })
    expect(e.date).toBe(dateInZone(e.time, 'Asia/Taipei'))
  })

  it('捷徑：沒填金額就當日記；收入分類；不認得的分類算其他', () => {
    expect(shortcutEntry({ amount: '', note: '今天天氣好' }, 'Asia/Taipei')).toMatchObject({ kind: 'diary', amount: null, amountTwd: null, categoryId: null })
    expect(shortcutEntry({ amount: 500, category: '退款' }, 'Asia/Taipei')).toMatchObject({ kind: 'income', categoryId: 'refund' })
    expect(shortcutEntry({ amount: 50, category: '飲料' }, 'Asia/Taipei')).toMatchObject({ kind: 'expense', categoryId: 'other' })
    expect(() => shortcutEntry({ amount: '' }, 'Asia/Taipei')).toThrow()
    expect(shortcutEntry({ amount: 0, category: '餐飲' }, 'Asia/Taipei')).toMatchObject({ kind: 'expense', amount: 0, amountTwd: 0, categoryId: 'food' })
    expect(shortcutEntry({ amount: '0' }, 'Asia/Taipei')).toMatchObject({ kind: 'expense', amount: 0 })
  })

  it('捷徑：步數只會變多（鎖定時讀到 0 不會蓋掉）', async () => {
    await call('/auto/steps', { body: { steps: '8,231', distance: '5.62', date: '2026-11-18' } })
    await call('/auto/steps', { body: { steps: 0, date: '2026-11-18' } })
    expect(sb.tables.daily_steps.get('2026-11-18')).toMatchObject({ date: '2026-11-18', steps: 8231, distanceKm: 5.62 })
    const r = await call('/auto/steps', { body: { steps: 9000, date: 'yesterday' } })
    const y = (await r.text()).match(/\d{4}-\d{2}-\d{2}/)[0]
    const today = dateInZone(Date.now(), 'Asia/Taipei')
    expect(y < today).toBe(true)
    expect(sb.tables.daily_steps.get(y)).toMatchObject({ steps: 9000 })
  })

  it('捷徑：記下位置', async () => {
    const r = await call('/auto/location', { body: { lat: '23.47', lng: '120.44' } })
    expect(await r.text()).toBe('已記下位置')
    expect((await call('/auto/location', { body: {} })).status).toBe(400)
  })

  it('小工具資料', async () => {
    sb.tables.entries.set('a', { id: 'a', kind: 'expense', date: '2026-11-18', time: 2, amountTwd: 120, title: '拉麵', note: '', location: { lat: 23.4, lng: 120.4, name: '東區 · 嘉義市' }, photoIds: [] })
    sb.tables.entries.set('b', { id: 'b', kind: 'expense', date: '2026-11-02', time: 1, amountTwd: 1000, title: '', note: '', location: null, photoIds: [] })
    sb.tables.entries.set('c', { id: 'c', kind: 'diary', date: '2025-11-18', time: 1, amountTwd: null, title: '', note: '去阿里山\n第二行', location: null, photoIds: ['p1'] })
    sb.tables.summaries.set('2025-11-18', { date: '2025-11-18', text: '很累但很開心', mood: 'good' })
    sb.tables.daily_steps.set('2026-11-18', { date: '2026-11-18', steps: 4000 })
    const r = await call('/auto/widget?date=2026-11-18', { method: 'GET' })
    const w = await r.json()
    expect(w).toMatchObject({ date: '2026-11-18', todayExpense: 120, monthExpense: 1120, steps: 4000, lastPlace: { name: '拉麵' }, route: [[23.4, 120.4]] })
    expect(w.yearAgo).toMatchObject({ date: '2025-11-18', summary: '很累但很開心', count: 1, photoId: 'p1', notes: [{ note: '去阿里山' }] })
  })

  it('七日回顧：8 天前～2 天前每天的支出、星期幾、合計、日均', async () => {
    sb.tables.entries.set('w1', { id: 'w1', kind: 'expense', date: '2026-11-15', time: 1, amountTwd: 820, title: '', note: '', location: null, photoIds: [] })
    sb.tables.entries.set('w2', { id: 'w2', kind: 'expense', date: '2026-11-21', time: 1, amountTwd: 390, title: '', note: '', location: null, photoIds: [] })
    sb.tables.entries.set('w3', { id: 'w3', kind: 'income', date: '2026-11-17', time: 1, amountTwd: 5000, title: '', note: '', location: null, photoIds: [] })
    sb.tables.entries.set('w4', { id: 'w4', kind: 'expense', date: '2026-11-22', time: 1, amountTwd: 999, title: '', note: '', location: null, photoIds: [] })
    const r = await (await call('/auto/widget?date=2026-11-23&week=1', { method: 'GET' })).json()
    expect(r.week.start).toBe('2026-11-15')
    expect(r.week.end).toBe('2026-11-21')
    expect(r.week.days).toHaveLength(7)
    expect(r.week.days[0]).toEqual({ date: '2026-11-15', weekday: 7, expense: 820 }) // 11/15 是星期日
    expect(r.week.days[1].weekday).toBe(1)
    expect(r.week.total).toBe(1210) // 收入和昨天（11/22）不算
    expect(r.week.avg).toBe(173)
  })

  it('小工具：今天還沒有定位點時，用前幾天最後的位置（顯示「今天在 ○○」）', async () => {
    sb.tables.track_points.set('y1', { id: 'y1', date: '2026-11-21', time: 100, lat: 25.04, lng: 121.45, accuracy: 10, source: 'auto' })
    sb.tables.track_points.set('y2', { id: 'y2', date: '2026-11-21', time: 200, lat: 25.05312, lng: 121.4511, accuracy: 16, source: 'auto' })
    sb.tables.track_points.set('y3', { id: 'y3', date: '2026-11-21', time: 300, lat: 25.1, lng: 121.5, accuracy: 900, source: 'auto' })
    const w = await (await call('/auto/widget?date=2026-11-22', { method: 'GET' })).json()
    expect(w.route).toEqual([[25.05312, 121.4511]])
    // 今天有點就不用前一天的
    sb.tables.track_points.set('t1', { id: 't1', date: '2026-11-22', time: 400, lat: 25.06, lng: 121.46, accuracy: 10, source: 'auto' })
    const w2 = await (await call('/auto/widget?date=2026-11-22', { method: 'GET' })).json()
    expect(w2.route).toEqual([[25.06, 121.46]])
  })

  it('路線點太多會平均挑', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i)
    const t = thinRoute(pts, 150)
    expect(t.length).toBe(150)
    expect(t[0]).toBe(0)
    expect(t[149]).toBe(999)
    expect(buildWidget({ date: '2026-11-18', entries: [], track: [], steps: undefined, yearAgo: { date: '2025-11-18', entries: [] } }).steps).toBeNull()
  })

  it('還沒執行 SQL 時提示', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ message: 'Could not find the function public.auto_key_info(p_key) in the schema cache' }), { status: 404 }))
    const r = await call('/auto/check', { method: 'GET', key: 'fresh-key' })
    expect(await r.text()).toMatch(/自動化設定 SQL/)
  })
})
