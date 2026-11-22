// 摳摳手帳 小工具（Scriptable）　版本 2026-11-22.3
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

// ── 復古紙張風：米灰舊紙、焦褐燒邊、深咖啡色字、襯線字；地圖用放大鏡 ──
const C = {
  paper: new Color('#C9BBA2'),
  card: new Color('#EFE5D3'),
  primary: new Color('#5A2E12'),
  dark: new Color('#4A2A14'),
  text: new Color('#2A1A0E'),
  sub: new Color('#4E331D'),
  faint: new Color('#5E3F24'),
  line: new Color('#7A5530'),
  soft: new Color('#E6D8BF'),
  over: new Color('#9E3B2C'),
  tile: new Color('#D9C9AC'),
}

/** 背景紙張圖（App 網站上的 widget/paper-*.jpg，下載一次存在手機上；換圖時把版本加 1） */
const PAPER_VER = 1

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

/** 下載不到紙張圖時的備用背景：米灰色＋四周變暗 */
function backgroundArt(w, h) {
  const dc = canvas(w, h)
  dc.setFillColor(C.paper)
  dc.fillRect(new Rect(0, 0, w, h))
  for (let i = 0; i < 14; i++) {
    const p = new Path()
    p.addRoundedRect(new Rect(i, i, w - i * 2, h - i * 2), 22, 22)
    dc.addPath(p)
    dc.setStrokeColor(new Color('#3A2412', 0.07 * (1 - i / 14)))
    dc.setLineWidth(1.5)
    dc.strokePath()
  }
  return dc.getImage()
}

async function loadPaper(kind) {
  const fm = FileManager.local()
  const file = fm.joinPath(fm.documentsDirectory(), `ledger-paper-v${PAPER_VER}-${kind}.jpg`)
  if (fm.fileExists(file)) {
    const img = fm.readImage(file)
    if (img) return img
  }
  try {
    const req = new Request(`${APP_URL}widget/paper-${kind}.jpg?v=${PAPER_VER}`)
    req.timeoutInterval = 10
    const img = await req.loadImage()
    if (req.response.statusCode !== 200) throw new Error(String(req.response.statusCode))
    fm.writeImage(file, img)
    return img
  } catch {
    return null
  }
}

/** 把紙張背景放上小工具（kind：medium／small） */
async function paintBg(w, kind) {
  const size = kind === 'small' ? new Size(158, 158) : new Size(338, 158)
  w.backgroundImage = (await loadPaper(kind)) || backgroundArt(size.width, size.height)
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

/** 在 dc 上畫第 z 層、左上角為世界像素 (left, top) 的底圖（w×h，1 個圖磚像素＝ppx 點），回傳畫了幾塊圖磚 */
async function drawTiles(dc, z, left, top, w, h, ppx = TILE_PT) {
  let tiles = 0
  const n = 2 ** z
  for (let ty = Math.floor(top / 256); ty <= Math.floor((top + h / ppx) / 256); ty++) {
    for (let tx = Math.floor(left / 256); tx <= Math.floor((left + w / ppx) / 256); tx++) {
      if (ty < 0 || ty >= n) continue
      const img = await loadTile(z, ((tx % n) + n) % n, ty)
      if (!img) continue
      dc.drawImageInRect(img, new Rect((tx * 256 - left) * ppx, (ty * 256 - top) * ppx, 256 * ppx, 256 * ppx))
      tiles++
    }
  }
  return tiles
}

/** 目前位置的圓點（外圈光暈＋白邊） */
function drawPin(dc, pt) {
  circle(dc, pt.x, pt.y, 10, new Color('#7A3A14', 0.2))
  circle(dc, pt.x, pt.y, 5.5, new Color('#F6EEDF'))
  circle(dc, pt.x, pt.y, 3.8, new Color('#8E3B1C'))
}

// ── 地圖卡片：模糊的舊地圖上放一支放大鏡，鏡片裡是清楚的地圖 ──
const CARD = { w: 140, h: 132 }
const LENS = { cx: 80, cy: 55, r: 44, rim: 5 }

/** 地圖要看哪裡：中心點、鏡片裡的縮放層級、路線 */
function mapView(route) {
  if (moved(route)) {
    const inner = (LENS.r - LENS.rim) * 2 - 18
    let z = 17
    let px
    for (; z >= 3; z--) {
      px = route.map((p) => worldPx(p[0], p[1], z))
      const rw = Math.max(...px.map((q) => q.x)) - Math.min(...px.map((q) => q.x))
      const rh = Math.max(...px.map((q) => q.y)) - Math.min(...px.map((q) => q.y))
      if (Math.max(rw, rh) * TILE_PT <= inner) break
    }
    const lats = route.map((p) => p[0])
    const lngs = route.map((p) => p[1])
    return { center: [(Math.max(...lats) + Math.min(...lats)) / 2, (Math.max(...lngs) + Math.min(...lngs)) / 2], z, route }
  }
  return { center: route[route.length - 1], z: 16, route: null }
}

/** 卡片底圖：模糊的舊地圖（用低 3 層的圖磚放大 8 倍，自然就糊了）＋鏡片陰影＋木頭把手 */
async function cardBackground(view) {
  const { w, h } = CARD
  const { cx, cy, r } = LENS
  const dc = canvas(w, h)
  dc.setFillColor(C.tile)
  dc.fillRect(new Rect(0, 0, w, h))
  if (view) {
    const bz = Math.max(1, view.z - 2) // 外面看到的範圍比鏡片大 4 倍
    const dz = Math.max(0, bz - 3)
    const ppx = TILE_PT * 2 ** (bz - dz)
    const q = worldPx(view.center[0], view.center[1], dz)
    await drawTiles(dc, dz, q.x - cx / ppx, q.y - cy / ppx, w, h, ppx)
  }
  // 舊紙色調
  dc.setFillColor(new Color('#C8AF86', 0.5))
  dc.fillRect(new Rect(0, 0, w, h))
  dc.setFillColor(new Color('#4A2E16', 0.08))
  dc.fillRect(new Rect(0, 0, w, h))
  // 四周暗一點
  for (let i = 0; i < 10; i++) {
    const p = new Path()
    p.addRoundedRect(new Rect(i, i, w - i * 2, h - i * 2), 14, 14)
    dc.addPath(p)
    dc.setStrokeColor(new Color('#3A2412', 0.06 * (1 - i / 10)))
    dc.setLineWidth(1.4)
    dc.strokePath()
  }
  // 鏡片在地圖上的影子
  for (let i = 0; i < 6; i++) circle(dc, cx + 4, cy + 6, r + 6 - i, new Color('#2A1A0E', 0.05))
  // 把手（往左下）：銅環＋深色木柄
  const ux = -Math.SQRT1_2
  const uy = Math.SQRT1_2
  const at = (d) => new Point(cx + ux * d, cy + uy * d)
  const seg = (d0, d1, width, color) => {
    const p = new Path()
    p.move(at(d0))
    p.addLine(at(d1))
    dc.addPath(p)
    dc.setStrokeColor(color)
    dc.setLineWidth(width)
    dc.strokePath()
  }
  seg(r + 6, r + 50, 10, new Color('#2A1A0E', 0.18)) // 把手的影子
  seg(r - 2, r + 10, 9, new Color('#8A5E24'))
  seg(r - 2, r + 10, 3, new Color('#E2B96A', 0.8))
  seg(r + 10, r + 48, 8, new Color('#3B2414'))
  seg(r + 10, r + 48, 2, new Color('#7A5236', 0.7))
  const end = at(r + 48)
  circle(dc, end.x, end.y, 4, new Color('#3B2414'))
  return dc.getImage()
}

/** 鏡片裡：清楚的地圖、路線或目前位置、玻璃的反光與邊緣暗角（外面會被裁成圓形） */
async function lensImage(view) {
  const d = (LENS.r - LENS.rim) * 2
  const dc = canvas(d, d)
  dc.setFillColor(C.soft)
  dc.fillRect(new Rect(0, 0, d, d))
  if (view) {
    const q = worldPx(view.center[0], view.center[1], view.z)
    const left = q.x - d / 2 / TILE_PT
    const top = q.y - d / 2 / TILE_PT
    await drawTiles(dc, view.z, left, top, d, d)
    dc.setFillColor(new Color('#E9D6B4', 0.3))
    dc.fillRect(new Rect(0, 0, d, d))
    const toPt = (p) => {
      const w = worldPx(p[0], p[1], view.z)
      return new Point((w.x - left) * TILE_PT, (w.y - top) * TILE_PT)
    }
    if (view.route) {
      const pts = view.route.map(toPt)
      const path = new Path()
      path.addLines(pts)
      dc.addPath(path)
      dc.setStrokeColor(new Color('#F6EEDF'))
      dc.setLineWidth(5)
      dc.strokePath()
      dc.addPath(path)
      dc.setStrokeColor(new Color('#8E3B1C'))
      dc.setLineWidth(2.5)
      dc.strokePath()
      circle(dc, pts[0].x, pts[0].y, 3.5, new Color('#4A2A14'))
      drawPin(dc, pts[pts.length - 1])
    } else drawPin(dc, toPt(view.center))
  }
  // 鏡片邊緣暗角
  for (let i = 0; i < 8; i++) {
    const p = new Path()
    p.addEllipse(new Rect(i, i, d - i * 2, d - i * 2))
    dc.addPath(p)
    dc.setStrokeColor(new Color('#2A1A0E', 0.07 * (1 - i / 8)))
    dc.setLineWidth(1.5)
    dc.strokePath()
  }
  // 玻璃反光（左上）
  circle(dc, d * 0.34, d * 0.27, d * 0.2, new Color('#FFFFFF', 0.1))
  circle(dc, d * 0.31, d * 0.24, d * 0.09, new Color('#FFFFFF', 0.16))
  return dc.getImage()
}

async function errorWidget(msg) {
  const w = new ListWidget()
  await paintBg(w, config.widgetFamily === 'small' ? 'small' : 'medium')
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

/** 右邊地圖卡片：模糊舊地圖＋放大鏡（有移動＝路線；沒移動＝目前位置），右下角寫地名或距離 */
async function rightCard(row, d) {
  const route = d.route || []
  const view = route.length ? mapView(route) : null
  let top = 'today'
  let main = '還沒有足跡'
  if (view && view.route) main = `走了 ${routeKm(route).toFixed(1)} km`
  else if (view) {
    top = 'today at'
    main = (await placeName(d)) || '同一個地方'
  }
  const { cx, cy, r, rim } = LENS
  const card = row.addStack()
  card.size = new Size(CARD.w, CARD.h)
  card.cornerRadius = 14
  card.backgroundImage = await cardBackground(view)
  card.layoutVertically()
  card.setPadding(0, 0, 6, 6)
  card.addSpacer(cy - r)
  const lensRow = card.addStack()
  lensRow.addSpacer(cx - r)
  // 銅框（漸層）＋裡面的圓形鏡片
  const rimStack = lensRow.addStack()
  rimStack.size = new Size(r * 2, r * 2)
  rimStack.cornerRadius = r
  const g = new LinearGradient()
  g.colors = [new Color('#F0D08A'), new Color('#B07D35'), new Color('#6B4518'), new Color('#C9984C')]
  g.locations = [0, 0.4, 0.75, 1]
  g.startPoint = new Point(0, 0)
  g.endPoint = new Point(1, 1)
  rimStack.backgroundGradient = g
  rimStack.setPadding(rim, rim, rim, rim)
  const glass = rimStack.addStack()
  const dd = (r - rim) * 2
  glass.size = new Size(dd, dd)
  glass.cornerRadius = dd / 2
  glass.borderColor = new Color('#3A2414', 0.6)
  glass.borderWidth = 1
  glass.backgroundImage = await lensImage(view)
  lensRow.addSpacer()
  card.addSpacer()
  const capRow = card.addStack()
  capRow.addSpacer()
  const chip = capRow.addStack()
  chip.layoutVertically()
  chip.backgroundColor = new Color('#EFE4CF', 0.94)
  chip.cornerRadius = 6
  chip.setPadding(2, 7, 3, 7)
  text(chip, top, 8, C.faint, serif(8, 'Italic'))
  text(chip, main, 10, C.text, Font.mediumSystemFont(10))
}

async function mediumWidget(d, stale) {
  const w = new ListWidget()
  await paintBg(w, 'medium')
  w.setPadding(14, 22, 12, 14)
  const row = w.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  const left = row.addStack()
  left.layoutVertically()
  left.size = new Size(150, 130)
  headerRows(left)
  text(left, money(d.todayExpense), 32, C.text, serif(32))
  countLine(left, d)
  left.addSpacer()
  monthBlock(left, d, 150)
  left.addSpacer(5)
  infoRow(left, d, stale)
  row.addSpacer()
  await rightCard(row, d)
  return w
}

async function smallWidget(d, stale) {
  const w = new ListWidget()
  await paintBg(w, 'small')
  w.setPadding(18, 20, 16, 20)
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
  await paintBg(w, 'small')
  w.setPadding(16, 16, 16, 16)
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
if (res.error) widget = await errorWidget(res.error)
else if (/一年前|year/i.test(param)) widget = await yearAgoWidget(res.data)
else if (family.startsWith('accessory')) widget = accessoryWidget(res.data)
else if (family === 'small') widget = await smallWidget(res.data, res.stale)
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
