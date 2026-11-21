// 摳摳手帳 小工具（Scriptable）　版本 2026-11-21.1
// 這份腳本由 App「設定 → 自動化 → 複製 Scriptable 腳本」產生，裡面已經填好你的網址和金鑰。
// 用法：
//   中型小工具：今日支出、本月預算進度、步數、最後地點、今天路線
//   小型小工具：今日支出與本月預算；「參數」填「一年前」→ 顯示一年前的今天
//   鎖定畫面（長方形）：今日支出與本月預算
// 金鑰等同密碼，不要把這份腳本分享給別人。

const BASE = '__BASE__'
const KEY = '__KEY__'
const BUDGET = __BUDGET__ // 每月預算（新台幣），0 表示不顯示預算
const APP_URL = '__APP_URL__'

const C = {
  bg: new Color('#F7EFE5'),
  card: new Color('#FFFBF5'),
  primary: new Color('#A0612B'),
  dark: new Color('#7A4A20'),
  text: new Color('#3A2618'),
  sub: new Color('#7D6450'),
  soft: new Color('#F6E7D6'),
  border: new Color('#E5D3BF'),
  over: new Color('#B5473A'),
}

const pad = (n) => String(n).padStart(2, '0')
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US')
const hm = (t) => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  const fm = FileManager.local()
  const cache = fm.joinPath(fm.cacheDirectory(), 'ledger-widget.json')
  try {
    const req = new Request(`${BASE}/widget?date=${dateKey(new Date())}`)
    req.headers = { Authorization: `Bearer ${KEY}` }
    req.timeoutInterval = 15
    const data = await req.loadJSON()
    if (req.response.statusCode !== 200) throw new Error(typeof data === 'string' ? data : JSON.stringify(data))
    fm.writeString(cache, JSON.stringify(data))
    return { data, stale: false }
  } catch (e) {
    // 沒網路時用上次的資料
    if (fm.fileExists(cache)) return { data: JSON.parse(fm.readString(cache)), stale: true }
    return { error: String(e.message || e) }
  }
}

async function loadPhoto(id) {
  try {
    const req = new Request(`${BASE}/photo/${id}`)
    req.headers = { Authorization: `Bearer ${KEY}` }
    req.timeoutInterval = 15
    return await req.loadImage()
  } catch {
    return null
  }
}

function text(stack, s, size, color, bold = false) {
  const t = stack.addText(s)
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size)
  t.textColor = color
  t.lineLimit = 1
  t.minimumScaleFactor = 0.6
  return t
}

/** 本月預算進度條 */
function budgetBar(width, used) {
  const h = 8
  const dc = new DrawContext()
  dc.size = new Size(width, h)
  dc.opaque = false
  dc.respectScreenScale = true
  const all = new Path()
  all.addRoundedRect(new Rect(0, 0, width, h), h / 2, h / 2)
  dc.addPath(all)
  dc.setFillColor(C.soft)
  dc.fillPath()
  const ratio = Math.min(1, BUDGET > 0 ? used / BUDGET : 0)
  if (ratio > 0) {
    const p = new Path()
    p.addRoundedRect(new Rect(0, 0, Math.max(h, width * ratio), h), h / 2, h / 2)
    dc.addPath(p)
    dc.setFillColor(used > BUDGET ? C.over : C.primary)
    dc.fillPath()
  }
  return dc.getImage()
}

const toRad = (d) => (d * Math.PI) / 180
function distanceM(a, b) {
  const s = Math.sin(toRad(b[0] - a[0]) / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(toRad(b[1] - a[1]) / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** 今天有沒有離開起點 200 公尺以上（沒有就不畫路線，改顯示文字） */
function moved(route) {
  return (route || []).some((p) => distanceM(route[0], p) > 200)
}

/** 目前所在的地名（用 iPhone 內建的地名查詢）；查不到用最後一筆紀錄的地名 */
async function placeName(d) {
  const last = d.route && d.route[d.route.length - 1]
  if (last) {
    try {
      const r = (await Location.reverseGeocode(last[0], last[1], 'zh_TW'))[0]
      const name = [r.subLocality, r.locality].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ')
      if (name) return name
    } catch {
      /* 查不到就用紀錄的地名 */
    }
  }
  return d.lastPlace ? d.lastPlace.name : ''
}

/** 還沒移動時：右邊改成文字卡片 */
function stillCard(stack, size, name, hasRoute) {
  const card = stack.addStack()
  card.size = new Size(size, size)
  card.cornerRadius = 14
  card.backgroundColor = new Color('#EEDFCC')
  card.layoutVertically()
  card.setPadding(10, 10, 10, 10)
  card.addSpacer()
  if (hasRoute) {
    text(card, '今天在', 11, C.sub)
    const t = card.addText(name || '同一個地方')
    t.font = Font.boldSystemFont(15)
    t.textColor = C.text
    t.lineLimit = 3
    t.minimumScaleFactor = 0.6
  } else {
    const t = card.addText('今天還沒有軌跡')
    t.font = Font.systemFont(12)
    t.textColor = C.sub
  }
  card.addSpacer()
}

// ── 路線縮圖的底圖：OpenStreetMap 圖磚（跟 App 的「OSM 奶茶」一樣，再蓋一層奶茶色） ──
const TILE_URL = 'https://tile.openstreetmap.org'
/** 圖磚存在手機上幾天（同一塊不重複下載，OSM 圖磚使用規範要求快取） */
const TILE_KEEP_DAYS = 14
/** 1 個圖磚像素畫成幾個小工具點（0.5＝256 px 的圖磚畫成 128 點，在 3 倍螢幕上清楚） */
const TILE_PT = 0.5

/** 經緯度 → 第 z 層的世界像素座標（Web Mercator，圖磚 256 px） */
function worldPx(lat, lng, z) {
  const n = 256 * 2 ** z
  const s = Math.sin(toRad(Math.max(-85, Math.min(85, lat))))
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n }
}

async function loadTile(z, x, y) {
  const fm = FileManager.local()
  const dir = fm.joinPath(fm.cacheDirectory(), 'ledger-tiles')
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true)
  const file = fm.joinPath(dir, `${z}-${x}-${y}.png`)
  if (fm.fileExists(file) && Date.now() - fm.modificationDate(file).getTime() < TILE_KEEP_DAYS * 86400000) {
    const img = fm.readImage(file)
    if (img) return img
  }
  try {
    const req = new Request(`${TILE_URL}/${z}/${x}/${y}.png`)
    req.headers = { 'User-Agent': 'KoukouLedgerWidget/1.0 (personal Scriptable widget)' }
    req.timeoutInterval = 10
    const img = await req.loadImage()
    if (req.response.statusCode !== 200) throw new Error(String(req.response.statusCode))
    fm.writeImage(file, img)
    return img
  } catch {
    // 沒網路：用舊的也好
    return fm.fileExists(file) ? fm.readImage(file) : null
  }
}

/** 今天路線縮圖（有地圖底圖；圖磚載不到就只畫路線） */
async function routeImage(route, size) {
  const dc = new DrawContext()
  dc.size = new Size(size, size)
  dc.respectScreenScale = true
  dc.opaque = false
  const bg = new Path()
  bg.addRoundedRect(new Rect(0, 0, size, size), 14, 14)
  dc.addPath(bg)
  dc.setFillColor(new Color('#EEDFCC'))
  dc.fillPath()
  if (!route || route.length === 0) {
    dc.setTextColor(C.sub)
    dc.setFont(Font.systemFont(12))
    dc.setTextAlignedCenter()
    dc.drawTextInRect('今天還沒有軌跡', new Rect(0, size / 2 - 8, size, 20))
    return dc.getImage()
  }
  const m = 16
  // 找最大的縮放層級，讓整條路線放得進去（最多 17，太近看不出在哪）
  let z = 17
  let px
  for (; z >= 3; z--) {
    px = route.map((p) => worldPx(p[0], p[1], z))
    const w = Math.max(...px.map((q) => q.x)) - Math.min(...px.map((q) => q.x))
    const h = Math.max(...px.map((q) => q.y)) - Math.min(...px.map((q) => q.y))
    if (Math.max(w, h) * TILE_PT <= size - m * 2) break
  }
  const cx = (Math.max(...px.map((q) => q.x)) + Math.min(...px.map((q) => q.x))) / 2
  const cy = (Math.max(...px.map((q) => q.y)) + Math.min(...px.map((q) => q.y))) / 2
  const half = size / TILE_PT / 2
  const left = cx - half
  const top = cy - half
  const toPt = (q) => new Point((q.x - left) * TILE_PT, (q.y - top) * TILE_PT)

  // 底圖
  let tiles = 0
  const n = 2 ** z
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + half * 2) / 256); ty++) {
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + half * 2) / 256); tx++) {
      if (ty < 0 || ty >= n) continue
      const img = await loadTile(z, ((tx % n) + n) % n, ty)
      if (!img) continue
      dc.drawImageInRect(img, new Rect((tx * 256 - left) * TILE_PT, (ty * 256 - top) * TILE_PT, 256 * TILE_PT, 256 * TILE_PT))
      tiles++
    }
  }
  if (tiles) {
    // 奶茶色濾鏡（DrawContext 沒有 multiply，用半透明色蓋一層）
    dc.setFillColor(new Color('#E9D3B8', 0.42))
    dc.fillRect(new Rect(0, 0, size, size))
  }

  const pts = px.map(toPt)
  if (pts.length > 1) {
    const path = new Path()
    path.addLines(pts)
    // 白邊讓線在地圖上看得清楚
    dc.addPath(path)
    dc.setStrokeColor(Color.white())
    dc.setLineWidth(6)
    dc.strokePath()
    dc.addPath(path)
    dc.setStrokeColor(C.primary)
    dc.setLineWidth(3)
    dc.strokePath()
  }
  const dot = (pt, color, r) => {
    dc.setFillColor(color)
    dc.fillEllipse(new Rect(pt.x - r, pt.y - r, r * 2, r * 2))
  }
  dot(pts[0], Color.white(), 5.5)
  dot(pts[0], C.dark, 4)
  dot(pts[pts.length - 1], Color.white(), 5)
  dot(pts[pts.length - 1], C.primary, 3.5)
  if (tiles) {
    dc.setTextColor(new Color('#3A2618', 0.7))
    dc.setFont(Font.systemFont(7))
    dc.setTextAlignedRight()
    dc.drawTextInRect('© OpenStreetMap', new Rect(0, size - 11, size - 6, 10))
  }
  return dc.getImage()
}

function errorWidget(msg) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  text(w, '摳摳手帳', 13, C.primary, true)
  w.addSpacer(6)
  const t = w.addText(msg)
  t.font = Font.systemFont(11)
  t.textColor = C.sub
  return w
}

function monthLine(stack, d, width) {
  if (BUDGET > 0) {
    const pct = Math.round((d.monthExpense / BUDGET) * 100)
    text(stack, `本月 ${money(d.monthExpense)} / ${money(BUDGET)}（${pct}%）`, 11, C.sub)
    stack.addSpacer(4)
    const img = stack.addImage(budgetBar(width, d.monthExpense))
    img.imageSize = new Size(width, 8)
  } else {
    text(stack, `本月 ${money(d.monthExpense)}`, 11, C.sub)
  }
}

async function mediumWidget(d, stale) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(14, 14, 14, 14)
  const row = w.addStack()
  row.layoutHorizontally()
  const left = row.addStack()
  left.layoutVertically()
  text(left, '今日支出', 12, C.sub)
  text(left, money(d.todayExpense), 28, C.text, true)
  left.addSpacer(4)
  monthLine(left, d, 170)
  left.addSpacer()
  if (d.steps != null) text(left, `步數 ${d.steps.toLocaleString('en-US')}`, 11, C.sub)
  if (d.lastPlace) text(left, `最後 ${hm(d.lastPlace.time)} ${d.lastPlace.name}`, 11, C.sub)
  if (stale) text(left, '（離線，顯示上次資料）', 9, C.sub)
  row.addSpacer()
  if (moved(d.route)) {
    const img = row.addImage(await routeImage(d.route, 120))
    img.imageSize = new Size(120, 120)
    img.cornerRadius = 14
  } else {
    stillCard(row, 120, await placeName(d), d.route && d.route.length > 0)
  }
  return w
}

function smallWidget(d, stale) {
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(14, 14, 14, 14)
  text(w, '今日支出', 12, C.sub)
  text(w, money(d.todayExpense), 26, C.text, true)
  w.addSpacer()
  monthLine(w, d, 120)
  if (d.steps != null) {
    w.addSpacer(4)
    text(w, `步數 ${d.steps.toLocaleString('en-US')}`, 11, C.sub)
  }
  if (stale) text(w, '離線', 9, C.sub)
  return w
}

async function yearAgoWidget(d) {
  const ya = d.yearAgo
  const w = new ListWidget()
  w.backgroundColor = C.bg
  w.setPadding(12, 12, 12, 12)
  const photo = ya.photoId ? await loadPhoto(ya.photoId) : null
  if (photo) {
    w.backgroundImage = photo
    const g = new LinearGradient()
    g.colors = [new Color('#000000', 0), new Color('#000000', 0.55)]
    g.locations = [0.35, 1]
    w.backgroundGradient = g
  }
  const fg = photo ? Color.white() : C.text
  const sub = photo ? new Color('#FFFFFF', 0.85) : C.sub
  text(w, '一年前的今天', 11, photo ? Color.white() : C.primary, true)
  text(w, ya.date.replace(/^(\d+)-(\d+)-(\d+)$/, (_, y, m, dd) => `${y}年${+m}月${+dd}日`), 10, sub)
  w.addSpacer()
  const line = ya.summary || ya.notes[0]?.note || ya.notes[0]?.title || (ya.count ? `${ya.count} 則紀錄` : '這天沒有紀錄')
  const t = w.addText(line)
  t.font = Font.mediumSystemFont(13)
  t.textColor = fg
  t.lineLimit = 3
  if (ya.expense > 0) text(w, `花了 ${money(ya.expense)}`, 10, sub)
  return w
}

function accessoryWidget(d) {
  const w = new ListWidget()
  text(w, `今日 ${money(d.todayExpense)}`, 14, Color.white(), true)
  text(w, BUDGET > 0 ? `本月 ${Math.round((d.monthExpense / BUDGET) * 100)}% 預算` : `本月 ${money(d.monthExpense)}`, 12, Color.white())
  if (d.steps != null) text(w, `${d.steps.toLocaleString('en-US')} 步`, 12, Color.white())
  return w
}

// 點小工具 → Scriptable 用 ?open=1 執行這個腳本 → 交給捷徑「打開記帳日記」
// → 捷徑用 webapp://網址 打開主畫面上的 App（不是 Safari）。
// 小工具直接設 webapp:// 或 shortcuts:// 網址，實測都只會停在 Scriptable 的腳本列表。
const OPEN_SHORTCUT = '打開記帳日記'
const openApp = (args.queryParameters || {}).open === '1'
if (openApp) {
  Safari.open('shortcuts://run-shortcut?name=' + encodeURIComponent(OPEN_SHORTCUT))
  Script.complete()
} else {
  await main()
}

async function main() {
const family = config.widgetFamily || 'medium'
const param = String(args.widgetParameter || '').trim()
const res = await load()
let widget
if (res.error) widget = errorWidget(res.error)
else if (/一年前|year/i.test(param)) widget = await yearAgoWidget(res.data)
else if (family.startsWith('accessory')) widget = accessoryWidget(res.data)
else if (family === 'small') widget = smallWidget(res.data, res.stale)
else widget = await mediumWidget(res.data, res.stale)
widget.url = URLScheme.forRunningScript() + '?open=1'
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000)

if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(widget)
} else if (/一年前|year/i.test(param) || family === 'small') {
  await widget.presentSmall()
} else {
  await widget.presentMedium()
}
Script.complete()
}
