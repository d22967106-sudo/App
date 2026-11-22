// 摳摳手帳 小工具（Scriptable）　版本 2026-11-22.1
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
  tile: new Color('#EEDFCC'),
  bgTop: new Color('#FBF6EF'),
  bgBottom: new Color('#F2E5D3'),
}

/** 小工具背景：上淺下深的奶茶色漸層 */
function paintBg(w) {
  const g = new LinearGradient()
  g.colors = [C.bgTop, C.bgBottom]
  g.locations = [0, 1]
  w.backgroundGradient = g
}

const WEEK = '日一二三四五六'
const dayLabel = (d = new Date()) => `${d.getMonth() + 1}/${d.getDate()} 週${WEEK[d.getDay()]}`

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
  t.font = bold === 'round' ? Font.boldRoundedSystemFont(size) : bold ? Font.boldSystemFont(size) : Font.systemFont(size)
  t.textColor = color
  t.lineLimit = 1
  t.minimumScaleFactor = 0.6
  return t
}

/** SF Symbols 小圖示＋文字 */
function iconText(stack, symbol, s, size, color) {
  const row = stack.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  const sym = SFSymbol.named(symbol)
  if (sym) {
    sym.applyFont(Font.mediumSystemFont(size))
    const img = row.addImage(sym.image)
    img.imageSize = new Size(size + 1, size + 1)
    img.tintColor = color
    row.addSpacer(3)
  }
  text(row, s, size, color)
  return row
}

/** 本月預算進度條 */
function budgetBar(width, used) {
  const h = 6
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

/** 在 dc 上畫第 z 層、左上角為世界像素 (left, top) 的底圖，回傳畫了幾塊圖磚 */
async function drawTiles(dc, z, left, top, size) {
  let tiles = 0
  const n = 2 ** z
  const span = size / TILE_PT
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + span) / 256); ty++) {
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + span) / 256); tx++) {
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
  return tiles
}

/** 目前位置的圓點（外圈光暈＋白邊） */
function drawPin(dc, pt) {
  const circle = (r, color) => {
    dc.setFillColor(color)
    dc.fillEllipse(new Rect(pt.x - r, pt.y - r, r * 2, r * 2))
  }
  circle(14, new Color('#A0612B', 0.18))
  circle(7.5, Color.white())
  circle(5.5, C.primary)
}

/** 還沒移動時的右邊卡片底圖：以目前位置為中心的地圖＋圓點（點放在上半部，下面留給地名） */
async function placeImage(p, size) {
  const dc = new DrawContext()
  dc.size = new Size(size, size)
  dc.respectScreenScale = true
  dc.opaque = false
  dc.setFillColor(C.tile)
  dc.fillRect(new Rect(0, 0, size, size))
  const z = 16
  const q = worldPx(p[0], p[1], z)
  const pinY = size * 0.32
  const left = q.x - size / TILE_PT / 2
  const top = q.y - pinY / TILE_PT
  await drawTiles(dc, z, left, top, size)
  drawPin(dc, new Point(size / 2, pinY))
  return dc.getImage()
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
  dc.setFillColor(C.tile)
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
    if (Math.max(w, h) * TILE_PT <= size - m * 2 - 10) break
  }
  const cx = (Math.max(...px.map((q) => q.x)) + Math.min(...px.map((q) => q.x))) / 2
  // 往下挪 10 點（路線畫高一點），下面留給「今天 ○ km」標籤
  const cy = (Math.max(...px.map((q) => q.y)) + Math.min(...px.map((q) => q.y))) / 2 + 10 / TILE_PT
  const half = size / TILE_PT / 2
  const left = cx - half
  const top = cy - half
  const toPt = (q) => new Point((q.x - left) * TILE_PT, (q.y - top) * TILE_PT)

  const tiles = await drawTiles(dc, z, left, top, size)

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
  drawPin(dc, pts[pts.length - 1])
  if (tiles) {
    dc.setTextColor(new Color('#3A2618', 0.7))
    dc.setFont(Font.systemFont(7))
    dc.setTextAlignedRight()
    dc.drawTextInRect('© OpenStreetMap', new Rect(0, 3, size - 7, 10))
  }
  return dc.getImage()
}

function errorWidget(msg) {
  const w = new ListWidget()
  paintBg(w)
  text(w, '摳摳手帳', 13, C.primary, true)
  w.addSpacer(6)
  const t = w.addText(msg)
  t.font = Font.systemFont(11)
  t.textColor = C.sub
  return w
}

/** 今天走了多遠（公里） */
function routeKm(route) {
  let m = 0
  for (let i = 1; i < (route || []).length; i++) m += distanceM(route[i - 1], route[i])
  return m / 1000
}

/** 第一列：「今日支出」＋右邊日期 */
function headerRow(stack) {
  const row = stack.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  text(row, '今日支出', 12, C.sub)
  row.addSpacer()
  const chip = row.addStack()
  chip.backgroundColor = C.soft
  chip.cornerRadius = 7
  chip.setPadding(2, 6, 2, 6)
  text(chip, dayLabel(), 10, C.dark, true)
}

/** 金額下面的小字：今天幾筆紀錄 */
function countLine(stack, d) {
  const n = d.todayCount || 0
  text(stack, n ? `今天 ${n} 筆紀錄` : '今天還沒記帳', 10, C.sub)
}

/** 本月：金額（＋預算剩多少、進度條） */
function monthBlock(stack, d, width) {
  const row = stack.addStack()
  row.layoutHorizontally()
  row.bottomAlignContent()
  text(row, '本月', 11, C.sub)
  row.addSpacer(4)
  text(row, money(d.monthExpense), 13, C.text, true)
  if (BUDGET > 0) {
    row.addSpacer()
    const left = BUDGET - d.monthExpense
    text(row, left >= 0 ? `剩 ${money(left)}` : `超出 ${money(-left)}`, 10, left >= 0 ? C.sub : C.over)
    stack.addSpacer(4)
    const img = stack.addImage(budgetBar(width, d.monthExpense))
    img.imageSize = new Size(width, 6)
  }
}

/** 最下面一列：步數、最後定位時間、離線 */
function infoRow(stack, d, stale) {
  const row = stack.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  let any = false
  if (d.steps != null) {
    iconText(row, 'figure.walk', d.steps.toLocaleString('en-US'), 10, C.sub)
    any = true
  }
  if (d.lastTime) {
    if (any) row.addSpacer(8)
    iconText(row, 'location.fill', hm(d.lastTime), 10, C.sub)
    any = true
  }
  if (stale) {
    if (any) row.addSpacer(8)
    iconText(row, 'wifi.slash', '離線', 10, C.over)
  }
}

/** 右邊卡片上的白底標籤 */
function cardLabel(card, top, main, mainSize) {
  const label = card.addStack()
  label.layoutVertically()
  label.backgroundColor = new Color('#FFFBF5', 0.92)
  label.cornerRadius = 9
  label.setPadding(4, 7, 5, 7)
  if (top) text(label, top, 9, C.sub)
  const t = label.addText(main)
  t.font = Font.boldSystemFont(mainSize)
  t.textColor = C.text
  t.lineLimit = 2
  t.minimumScaleFactor = 0.6
}

/** 右邊卡片：有移動＝路線；沒移動＝目前位置地圖＋地名；沒有點＝提示 */
async function rightCard(row, d, size) {
  const card = row.addStack()
  card.size = new Size(size, size)
  card.cornerRadius = 16
  card.layoutVertically()
  card.setPadding(6, 6, 6, 6)
  const route = d.route || []
  if (moved(route)) {
    card.backgroundImage = await routeImage(route, size)
    card.addSpacer()
    const chipRow = card.addStack()
    const chip = chipRow.addStack()
    chipRow.addSpacer()
    chip.backgroundColor = new Color('#FFFBF5', 0.92)
    chip.cornerRadius = 8
    chip.setPadding(3, 6, 3, 6)
    text(chip, `今天 ${routeKm(route).toFixed(1)} km`, 10, C.text, true)
  } else if (route.length > 0) {
    card.backgroundImage = await placeImage(route[route.length - 1], size)
    card.addSpacer()
    const lab = card.addStack()
    lab.layoutHorizontally()
    cardLabel(lab, '今天在', (await placeName(d)) || '同一個地方', 12)
  } else {
    card.backgroundColor = C.tile
    card.addSpacer()
    const r = card.addStack()
    r.addSpacer()
    const sym = SFSymbol.named('location.slash')
    sym.applyFont(Font.systemFont(22))
    const img = r.addImage(sym.image)
    img.imageSize = new Size(22, 22)
    img.tintColor = C.sub
    r.addSpacer()
    card.addSpacer(6)
    const r2 = card.addStack()
    r2.addSpacer()
    text(r2, '今天還沒有軌跡', 11, C.sub)
    r2.addSpacer()
    card.addSpacer()
  }
}

async function mediumWidget(d, stale) {
  const w = new ListWidget()
  paintBg(w)
  w.setPadding(14, 16, 14, 14)
  const row = w.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  const left = row.addStack()
  left.layoutVertically()
  left.size = new Size(160, 128)
  headerRow(left)
  left.addSpacer(2)
  text(left, money(d.todayExpense), 32, C.text, 'round')
  countLine(left, d)
  left.addSpacer()
  monthBlock(left, d, 160)
  left.addSpacer(7)
  infoRow(left, d, stale)
  row.addSpacer()
  await rightCard(row, d, 128)
  return w
}

function smallWidget(d, stale) {
  const w = new ListWidget()
  paintBg(w)
  w.setPadding(14, 14, 14, 14)
  headerRow(w)
  w.addSpacer(2)
  text(w, money(d.todayExpense), 28, C.text, 'round')
  countLine(w, d)
  w.addSpacer()
  monthBlock(w, d, 126)
  w.addSpacer(6)
  infoRow(w, d, stale)
  return w
}

async function yearAgoWidget(d) {
  const ya = d.yearAgo
  const w = new ListWidget()
  paintBg(w)
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

// 點小工具 → Scriptable 用 ?open=1 執行這個腳本 → 交給捷徑「打開摳摳手帳」
// → 捷徑用 webapp://網址 打開主畫面上的 App（不是 Safari）。
// 小工具直接設 webapp:// 或 shortcuts:// 網址，實測都只會停在 Scriptable 的腳本列表。
const OPEN_SHORTCUT = '打開摳摳手帳'
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
