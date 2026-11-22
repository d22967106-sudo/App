// 摳摳手帳 小工具（Scriptable）　版本 2026-11-22.2
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

// ── 文青風：奶茶色系、紙張質感、細線、襯線字 ──
const C = {
  paper: new Color('#F7F0E6'),
  card: new Color('#FFFCF7'),
  primary: new Color('#9A6B47'),
  dark: new Color('#6E4B32'),
  text: new Color('#3B2C22'),
  sub: new Color('#8C7462'),
  faint: new Color('#B49C88'),
  line: new Color('#D8C6B3'),
  soft: new Color('#EFE3D4'),
  over: new Color('#B0574A'),
  tile: new Color('#ECE0D0'),
}

/** 襯線字（iPhone 內建的 Baskerville；找不到時 iOS 會自動用系統字） */
const serif = (size, style = 'SemiBold') => new Font(`Baskerville-${style}`, size)

const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (d = new Date()) => `${MONTH_EN[d.getMonth()]}. ${d.getDate()}  ·  ${WEEK_EN[d.getDay()]}`

/** 畫布（透明、跟螢幕倍率一樣清楚） */
function canvas(w, h) {
  const dc = new DrawContext()
  dc.size = new Size(w, h)
  dc.opaque = false
  dc.respectScreenScale = true
  return dc
}

const circle = (dc, x, y, r, color) => {
  dc.setFillColor(color)
  dc.fillEllipse(new Rect(x - r, y - r, r * 2, r * 2))
}

/** 固定的亂數（每次畫出來的紙紋都一樣） */
function rand(seed) {
  let x = seed
  return () => {
    x = (x * 16807) % 2147483647
    return x / 2147483647
  }
}

/**
 * 背景：米色紙張（很淡的上下漸層＋細細的紙纖維顆粒）＋內縮一圈的細線框，像筆記本或明信片。
 */
function backgroundArt(w, h) {
  const dc = canvas(w, h)
  const a = [0xf9, 0xf3, 0xea]
  const b = [0xf1, 0xe6, 0xd7]
  for (let y = 0; y < h; y += 2) {
    const t = y / h
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')
    dc.setFillColor(new Color('#' + c))
    dc.fillRect(new Rect(0, y, w, 2.5))
  }
  // 紙纖維顆粒
  const r = rand(w * 31 + h)
  for (let i = 0; i < w * h * 0.03; i++) {
    const dark = r() < 0.6
    dc.setFillColor(new Color(dark ? '#7A5A40' : '#FFFFFF', dark ? 0.05 + r() * 0.05 : 0.35))
    dc.fillRect(new Rect(r() * w, r() * h, 0.6 + r() * 0.8, 0.6 + r() * 0.5))
  }
  // 細線框
  const frame = new Path()
  frame.addRoundedRect(new Rect(7, 7, w - 14, h - 14), 13, 13)
  dc.addPath(frame)
  dc.setStrokeColor(new Color('#C9B29A', 0.55))
  dc.setLineWidth(0.8)
  dc.strokePath()
  return dc.getImage()
}

/** 把背景放上小工具 */
function paintBg(w, size) {
  w.backgroundImage = backgroundArt(size.width, size.height)
}

/** 細細一條分隔線 */
function hairline(width, color = C.line) {
  const dc = canvas(width, 1)
  dc.setFillColor(color)
  dc.fillRect(new Rect(0, 0, width, 0.6))
  return dc.getImage()
}

/** 本月預算進度：細線底軌＋奶茶色線段＋盡頭一個小圓點 */
function budgetLine(width, used) {
  const h = 7
  const dc = canvas(width, h)
  const y = h / 2
  dc.setFillColor(C.line)
  dc.fillRect(new Rect(0, y - 0.5, width, 1))
  const ratio = Math.min(1, BUDGET > 0 ? used / BUDGET : 0)
  const color = used > BUDGET ? C.over : C.primary
  const x = Math.max(3, (width - 3) * ratio)
  dc.setFillColor(color)
  dc.fillRect(new Rect(0, y - 1, x, 2))
  circle(dc, x, y, 3, color)
  circle(dc, x, y, 1.4, C.card)
  return dc.getImage()
}

function text(stack, s, size, color, font) {
  const t = stack.addText(s)
  t.font = font || Font.systemFont(size)
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
    sym.applyFont(Font.lightSystemFont(size))
    const img = row.addImage(sym.image)
    img.imageSize = new Size(size, size)
    img.tintColor = color
    row.addSpacer(3)
  }
  text(row, s, size, color, serif(size + 1, 'Regular'))
  return row
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

/** 在 dc 上畫第 z 層、左上角為世界像素 (left, top) 的底圖（w×h），回傳畫了幾塊圖磚 */
async function drawTiles(dc, z, left, top, w, h) {
  let tiles = 0
  const n = 2 ** z
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h / TILE_PT) / 256); ty++) {
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w / TILE_PT) / 256); tx++) {
      if (ty < 0 || ty >= n) continue
      const img = await loadTile(z, ((tx % n) + n) % n, ty)
      if (!img) continue
      dc.drawImageInRect(img, new Rect((tx * 256 - left) * TILE_PT, (ty * 256 - top) * TILE_PT, 256 * TILE_PT, 256 * TILE_PT))
      tiles++
    }
  }
  if (tiles) {
    // 奶茶色濾鏡（DrawContext 沒有 multiply，用半透明色蓋一層）
    dc.setFillColor(new Color('#EADBC8', 0.5))
    dc.fillRect(new Rect(0, 0, w, h))
  }
  return tiles
}

/** 目前位置的圓點（外圈光暈＋白邊） */
function drawPin(dc, pt) {
  circle(dc, pt.x, pt.y, 12, new Color('#A0612B', 0.2))
  circle(dc, pt.x, pt.y, 6.5, Color.white())
  circle(dc, pt.x, pt.y, 4.5, C.primary)
}

/** 目前位置為中心的地圖（w×h） */
async function placeMap(p, w, h) {
  const dc = canvas(w, h)
  dc.setFillColor(C.tile)
  dc.fillRect(new Rect(0, 0, w, h))
  const z = 16
  const q = worldPx(p[0], p[1], z)
  await drawTiles(dc, z, q.x - w / TILE_PT / 2, q.y - h / TILE_PT / 2, w, h)
  drawPin(dc, new Point(w / 2, h / 2))
  return dc.getImage()
}

/** 今天路線地圖（w×h；圖磚載不到就只畫路線） */
async function routeMap(route, w, h) {
  const dc = canvas(w, h)
  dc.setFillColor(C.tile)
  dc.fillRect(new Rect(0, 0, w, h))
  const m = 14
  // 找最大的縮放層級，讓整條路線放得進去（最多 17，太近看不出在哪）
  let z = 17
  let px
  for (; z >= 3; z--) {
    px = route.map((p) => worldPx(p[0], p[1], z))
    const rw = Math.max(...px.map((q) => q.x)) - Math.min(...px.map((q) => q.x))
    const rh = Math.max(...px.map((q) => q.y)) - Math.min(...px.map((q) => q.y))
    if (rw * TILE_PT <= w - m * 2 && rh * TILE_PT <= h - m * 2) break
  }
  const cx = (Math.max(...px.map((q) => q.x)) + Math.min(...px.map((q) => q.x))) / 2
  const cy = (Math.max(...px.map((q) => q.y)) + Math.min(...px.map((q) => q.y))) / 2
  const left = cx - w / TILE_PT / 2
  const top = cy - h / TILE_PT / 2
  await drawTiles(dc, z, left, top, w, h)
  const pts = px.map((q) => new Point((q.x - left) * TILE_PT, (q.y - top) * TILE_PT))
  if (pts.length > 1) {
    const path = new Path()
    path.addLines(pts)
    dc.addPath(path)
    dc.setStrokeColor(Color.white())
    dc.setLineWidth(6)
    dc.strokePath()
    dc.addPath(path)
    dc.setStrokeColor(C.primary)
    dc.setLineWidth(3)
    dc.strokePath()
  }
  circle(dc, pts[0].x, pts[0].y, 5, Color.white())
  circle(dc, pts[0].x, pts[0].y, 3.5, C.dark)
  drawPin(dc, pts[pts.length - 1])
  return dc.getImage()
}

/**
 * 拍立得相框：白框＋淡淡的陰影＋上面一段斜斜的紙膠帶，照片放上半部，下面白邊寫字。
 * 回傳 { image, photoBottom }（字從 photoBottom 開始放）
 */
const POLA = { w: 124, h: 132, inset: 6, photoH: 86 }
function polaroid(photo, osm) {
  const { w, h, inset, photoH } = POLA
  const dc = canvas(w, h)
  const fx = 3
  const fy = 7
  const fw = w - 6
  const fh = h - 10
  // 陰影（往右下疊幾層半透明）
  for (let i = 3; i >= 1; i--) {
    const p = new Path()
    p.addRoundedRect(new Rect(fx + i * 0.6, fy + i * 0.9, fw, fh), 6, 6)
    dc.addPath(p)
    dc.setFillColor(new Color('#6E4B32', 0.05))
    dc.fillPath()
  }
  const frame = new Path()
  frame.addRoundedRect(new Rect(fx, fy, fw, fh), 6, 6)
  dc.addPath(frame)
  dc.setFillColor(new Color('#FFFDF9'))
  dc.fillPath()
  const px = fx + inset
  const py = fy + inset
  const pw = fw - inset * 2
  if (photo) dc.drawImageInRect(photo, new Rect(px, py, pw, photoH))
  else {
    // 空白相片：淡色底＋極簡線條小插畫（太陽與山）
    dc.setFillColor(C.soft)
    dc.fillRect(new Rect(px, py, pw, photoH))
    const cx = px + pw / 2
    const cy = py + photoH / 2 + 4
    dc.setStrokeColor(new Color('#B49C88', 0.9))
    dc.setLineWidth(1)
    const sun = new Path()
    sun.addEllipse(new Rect(cx + 6, cy - 22, 11, 11))
    dc.addPath(sun)
    dc.strokePath()
    const hills = new Path()
    hills.addLines([new Point(cx - 26, cy + 8), new Point(cx - 10, cy - 9), new Point(cx, cy + 1), new Point(cx + 8, cy - 5), new Point(cx + 26, cy + 8)])
    dc.addPath(hills)
    dc.strokePath()
  }
  if (osm) {
    dc.setTextColor(new Color('#3A2618', 0.55))
    dc.setFont(Font.systemFont(6))
    dc.setTextAlignedRight()
    dc.drawTextInRect('© OpenStreetMap', new Rect(px, py + photoH - 9, pw - 3, 8))
  }
  // 紙膠帶（斜的平行四邊形，半透明奶茶色＋細條紋）
  const tape = new Path()
  tape.addLines([new Point(w / 2 - 22, 4), new Point(w / 2 + 16, 0), new Point(w / 2 + 19, 11), new Point(w / 2 - 19, 15)])
  tape.closeSubpath()
  dc.addPath(tape)
  dc.setFillColor(new Color('#CDB397', 0.6))
  dc.fillPath()
  dc.setStrokeColor(new Color('#FFFFFF', 0.35))
  dc.setLineWidth(1)
  for (let i = 0; i < 6; i++) {
    const l = new Path()
    const x = w / 2 - 15 + i * 6.5
    l.move(new Point(x, 3.5 - i * 0.6))
    l.addLine(new Point(x + 2.6, 13.5 - i * 0.6))
    dc.addPath(l)
    dc.strokePath()
  }
  return { image: dc.getImage(), photoBottom: fy + inset + photoH }
}

function errorWidget(msg) {
  const w = new ListWidget()
  paintBg(w, new Size(338, 158))
  w.setPadding(18, 20, 18, 20)
  text(w, '摳摳手帳', 13, C.primary, Font.semiboldSystemFont(13))
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

/** 上面兩行：英文日期（斜體）、今日支出 */
function headerRows(stack) {
  text(stack, dayLabel(), 11, C.primary, serif(11, 'Italic'))
  stack.addSpacer(5)
  text(stack, '今日支出', 10, C.sub, Font.lightSystemFont(10))
}

/** 金額下面的小字 */
function countLine(stack, d) {
  const n = d.todayCount || 0
  text(stack, n ? `今天記了 ${n} 筆` : '今天還沒有記帳', 9, C.faint, Font.lightSystemFont(9))
}

/** 本月：分隔線（或預算進度線）＋金額 */
function monthBlock(stack, d, width) {
  if (BUDGET > 0) {
    const img = stack.addImage(budgetLine(width, d.monthExpense))
    img.imageSize = new Size(width, 7)
  } else {
    const img = stack.addImage(hairline(width))
    img.imageSize = new Size(width, 1)
  }
  stack.addSpacer(4)
  const row = stack.addStack()
  row.layoutHorizontally()
  row.bottomAlignContent()
  text(row, '本月', 10, C.sub, Font.lightSystemFont(10))
  row.addSpacer(5)
  text(row, money(d.monthExpense), 13, C.text, serif(13))
  if (BUDGET > 0) {
    row.addSpacer()
    const left = BUDGET - d.monthExpense
    text(row, left >= 0 ? `剩 ${money(left)}` : `超出 ${money(-left)}`, 10, left >= 0 ? C.sub : C.over, Font.lightSystemFont(10))
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
    if (any) row.addSpacer(9)
    iconText(row, 'location', hm(d.lastTime), 10, C.sub)
    any = true
  }
  if (stale) {
    if (any) row.addSpacer(9)
    iconText(row, 'wifi.slash', '離線', 10, C.over)
  }
}

/** 右邊拍立得：有移動＝路線；沒移動＝目前位置；沒有點＝空白相片。下面白邊寫字。 */
async function rightCard(row, d) {
  const route = d.route || []
  const pw = POLA.w - 6 - POLA.inset * 2
  let photo = null
  let main = ''
  if (moved(route)) {
    photo = await routeMap(route, pw, POLA.photoH)
    main = `走了 ${routeKm(route).toFixed(1)} km`
  } else if (route.length > 0) {
    photo = await placeMap(route[route.length - 1], pw, POLA.photoH)
    main = (await placeName(d)) || '同一個地方'
  } else {
    main = '還沒有足跡'
  }
  const { image, photoBottom } = polaroid(photo, !!photo)
  const card = row.addStack()
  card.size = new Size(POLA.w, POLA.h)
  card.backgroundImage = image
  card.layoutVertically()
  card.addSpacer(photoBottom + 3)
  const lab = card.addStack()
  lab.layoutVertically()
  lab.setPadding(0, 11, 0, 9)
  text(lab, route.length && !moved(route) ? 'today at' : 'today', 9, C.faint, serif(9, 'Italic'))
  text(lab, main, 11, C.text, Font.mediumSystemFont(11))
  card.addSpacer()
}

async function mediumWidget(d, stale) {
  const w = new ListWidget()
  paintBg(w, new Size(338, 158))
  w.setPadding(14, 20, 12, 14)
  const row = w.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  const left = row.addStack()
  left.layoutVertically()
  left.size = new Size(158, 130)
  headerRows(left)
  text(left, money(d.todayExpense), 32, C.text, serif(32))
  countLine(left, d)
  left.addSpacer()
  monthBlock(left, d, 158)
  left.addSpacer(5)
  infoRow(left, d, stale)
  row.addSpacer()
  await rightCard(row, d)
  return w
}

function smallWidget(d, stale) {
  const w = new ListWidget()
  paintBg(w, new Size(158, 158))
  w.setPadding(16, 18, 14, 18)
  headerRows(w)
  text(w, money(d.todayExpense), 28, C.text, serif(28))
  countLine(w, d)
  w.addSpacer()
  monthBlock(w, d, 122)
  w.addSpacer(5)
  infoRow(w, d, stale)
  return w
}

async function yearAgoWidget(d) {
  const ya = d.yearAgo
  const w = new ListWidget()
  paintBg(w, new Size(158, 158))
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
  text(w, '一年前的今天', 11, photo ? Color.white() : C.primary, Font.semiboldSystemFont(11))
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
  text(w, `今日 ${money(d.todayExpense)}`, 14, Color.white(), Font.boldSystemFont(14))
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
