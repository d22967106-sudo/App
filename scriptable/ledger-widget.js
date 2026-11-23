// 摳摳手帳 小工具（Scriptable）　版本 2026-11-23.1
// 這份腳本由 App「設定 → 自動化 → 複製 Scriptable 腳本」產生，裡面已經填好你的網址和金鑰。
// 用法：
//   預設是「昨日回顧」：昨天的支出、本月預算進度、昨天的步數、昨天的路線（昨天的事不會再變，一天只更新幾次）
//   中型小工具：支出、本月預算進度、步數、路線；小型小工具：支出與本月預算；鎖定畫面（長方形）：支出與本月預算
//   「參數」填「今天」→ 改看今天（即時，但 iOS 不一定常常更新）；填「一年前」→ 顯示一年前的今天
// 金鑰等同密碼，不要把這份腳本分享給別人。

const BASE = '__BASE__'
const KEY = '__KEY__'
const BUDGET = __BUDGET__ // 每月預算（新台幣），0 表示不顯示預算
const APP_URL = '__APP_URL__'

// ── 復古紙張風：米灰舊紙、焦褐燒邊、深咖啡色字、草寫體數字；地圖用放大鏡 ──
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

/** 小工具用的圖（App 網站上的 widget/：紙張、放大鏡、玻璃反光），下載一次存在手機上；換圖時把版本加 1 */
const ART_VER = 12

/** 襯線字（iPhone 內建的 Baskerville；找不到時 iOS 會自動用系統字） */
const serif = (size, style = 'SemiBold') => new Font(`Baskerville-${style}`, size)
/**
 * 中文行書字：南構無恙行書。Scriptable 用不到 iPhone 另外裝的字體，
 * 所以把「固定出現的字」的外形先做成 widget/glyphs.json（make-widget-art.py 讀下面這行產生），
 * 小工具自己畫成圖片。不在這行裡的字（或下載不到時）就用系統字。改這行要重新產生 glyphs.json 並把 ART_VER 加 1。
 * 這套字體只有簡體字，所以固定字句都挑繁簡寫法相同的字（例如「今天在此」「今天未留足印」）。
 */
/** 這套行書的字形在字框裡畫得比較小、字距寬：畫的時候放大、字距收緊 */
const CN_SCALE = 1.3
const CN_TRACK = 0.88
const GLYPH_SET = '今日支出　共件尚未本月剩超出今天在此走了留足印一年前的花昨上 0123456789$,.:km'
/** 草寫體（iPhone 內建的 Snell Roundhand，只有英文與數字；中文 iPhone 沒有內建草書字體） */
const script = (size, bold = true) => new Font(bold ? 'SnellRoundhand-Bold' : 'SnellRoundhand', size)

const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEK_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const dayLabel = (d = new Date()) => `${WEEK_FULL[d.getDay()]}, ${MONTH_EN[d.getMonth()]} ${d.getDate()}`

// ── 看哪一天：預設昨天（昨日回顧，2026-11-23 使用者要求：不需要一直更新的小工具） ──
const PARAM = String(args.widgetParameter || '').trim()
const SHOW_TODAY = /今天|今日|today/i.test(PARAM) || /一年前|year/i.test(PARAM)
const SHOW_DATE = (() => {
  const d = new Date()
  if (!SHOW_TODAY) d.setDate(d.getDate() - 1)
  return d
})()
/** 「今天」或「昨天」（昨、今繁簡同字，手寫字形裡有） */
const DAY_WORD = SHOW_TODAY ? '今天' : '昨天'
const DAY_SHORT = SHOW_TODAY ? '今日' : '昨日'
/** 昨天是上個月（今天是 1 號）時，「本月」改成「上月」 */
const MONTH_WORD = SHOW_DATE.getMonth() === new Date().getMonth() ? '本月' : '上月'

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

async function loadArt(name) {
  const fm = FileManager.local()
  const file = fm.joinPath(fm.documentsDirectory(), `ledger-art-v${ART_VER}-${name}`)
  if (fm.fileExists(file)) {
    const img = fm.readImage(file)
    if (img) return img
  }
  try {
    const req = new Request(`${APP_URL}widget/${name}?v=${ART_VER}`)
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
  w.backgroundImage = (await loadArt(`paper-${kind}.jpg`)) || backgroundArt(size.width, size.height)
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

// ── 手寫中文字：把 glyphs.json 裡的字形畫成圖片 ──
let GLYPHS = undefined
async function loadGlyphs() {
  if (GLYPHS !== undefined) return GLYPHS
  GLYPHS = null
  const fm = FileManager.local()
  const file = fm.joinPath(fm.documentsDirectory(), `ledger-art-v${ART_VER}-glyphs.json`)
  try {
    if (fm.fileExists(file)) GLYPHS = JSON.parse(fm.readString(file))
    else {
      const req = new Request(`${APP_URL}widget/glyphs.json?v=${ART_VER}`)
      req.timeoutInterval = 10
      const txt = await req.loadString()
      if (req.response.statusCode !== 200) throw new Error(String(req.response.statusCode))
      GLYPHS = JSON.parse(txt)
      fm.writeString(file, txt)
    }
  } catch {
    GLYPHS = null
  }
  return GLYPHS
}

/** 把一行字畫成圖片（字形座標：1 em＝g.em 單位，y 往上；每個輪廓 M 開頭，後面是相對前一點的位移） */
function glyphImage(str, size, color, G) {
  size = size * CN_SCALE
  const k = size / G.em
  const chars = [...str]
  const advOf = (ch) => G.g[ch][0] * (ch.charCodeAt(0) > 0x2000 ? CN_TRACK : 1)
  const width = Math.max(1, chars.reduce((w, ch) => w + advOf(ch), 0) * k)
  const h = size * 1.28
  const base = size * (G.asc || 0.93) + size * 0.06
  const dc = canvas(Math.ceil(width) + 1, Math.ceil(h))
  dc.setFillColor(color)
  let pen = 0
  for (const ch of chars) {
    const d = G.g[ch][1]
    const adv = advOf(ch)
    // 收緊字距時，字形往左挪一半，保持置中
    const shift = (G.g[ch][0] - adv) / 2
    if (d) {
      const path = new Path()
      const tok = d.match(/M|-?\d+/g)
      let x = 0
      let y = 0
      let first = true
      for (let i = 0; i < tok.length; ) {
        if (tok[i] === 'M') {
          if (!first) path.closeSubpath()
          first = true
          i++
          continue
        }
        x += +tok[i]
        y += +tok[i + 1]
        i += 2
        const p = new Point((pen + x - shift) * k, base - y * k)
        if (first) path.move(p)
        else path.addLine(p)
        first = false
      }
      path.closeSubpath()
      dc.addPath(path)
      dc.fillPath()
    }
    pen += adv
  }
  return { image: dc.getImage(), size: new Size(Math.ceil(width) + 1, Math.ceil(h)) }
}

/** 手寫中文：字都在 glyphs.json 裡就畫成圖片，否則用系統字 */
async function cnText(stack, str, size, color) {
  const G = await loadGlyphs()
  if (G && [...str].every((ch) => G.g[ch])) {
    const { image, size: sz } = glyphImage(str, size, color, G)
    const img = stack.addImage(image)
    img.imageSize = sz
    return img
  }
  return text(stack, str, size, color, Font.systemFont(size))
}

/**
 * 腳底板腳印 👣：兩隻赤腳（左腳在左上、右腳在右下，稍微往外撇）。
 * 腳掌是一整塊平滑輪廓（前寬、內側足弓凹、腳跟圓），上面五根腳趾排成弧形，大拇趾最大在內側。
 */
function footprints(size, color) {
  const dc = canvas(size, size)
  dc.setFillColor(color)
  // 左腳的形狀（單位座標：寬約 1、長約 2.2，往上是腳趾）
  const SOLE = [
    [0.08, 0.45],
    [[0.06, 0.12], [0.3, -0.02], [0.56, 0.0]],
    [[0.84, 0.02], [1.04, 0.2], [1.0, 0.5]],
    [[0.96, 0.85], [0.64, 0.95], [0.66, 1.4]], // 內側足弓往內凹
    [[0.68, 1.85], [0.78, 2.22], [0.46, 2.22]],
    [[0.16, 2.22], [0.14, 1.9], [0.2, 1.6]],
    [[0.26, 1.2], [0.02, 0.9], [0.08, 0.45]],
  ]
  const TOES = [
    [0.02, 0.12, 0.085],
    [0.17, -0.07, 0.1],
    [0.36, -0.2, 0.11],
    [0.6, -0.27, 0.13],
    [0.9, -0.24, 0.175],
  ]
  const foot = (cx, cy, scale, angle, mirror) => {
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    // 以腳的中心（0.5, 1.0）為原點旋轉、縮放、移到 (cx, cy)
    const P = (x, y) => {
      const u = (mirror ? 0.5 - (x - 0.5) : x) - 0.5
      const v = y - 1.0
      return new Point(cx + (u * ca - v * sa) * scale, cy + (u * sa + v * ca) * scale)
    }
    const path = new Path()
    path.move(P(...SOLE[0]))
    for (let i = 1; i < SOLE.length; i++) {
      const [c1, c2, e] = SOLE[i]
      path.addCurve(P(...e), P(...c1), P(...c2))
    }
    path.closeSubpath()
    dc.addPath(path)
    dc.fillPath()
    for (const [x, y, r] of TOES) {
      const c = P(x, y)
      const rr = r * scale
      dc.fillEllipse(new Rect(c.x - rr, c.y - rr * 1.08, rr * 2, rr * 2.16))
    }
  }
  const k = size / 24
  foot(7.4 * k, 9.6 * k, 5.3 * k, -0.3, false) // 左腳，左上
  foot(16.6 * k, 14.6 * k, 5.3 * k, 0.3, true) // 右腳，右下
  return dc.getImage()
}

/** SF Symbols 小圖示＋文字（symbol 為 'footprints' 時用自己畫的腳印） */
async function iconText(stack, symbol, s, size, color) {
  const row = stack.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  if (symbol === 'footprints') {
    const img = row.addImage(footprints(size + 7, color))
    img.imageSize = new Size(size + 7, size + 7)
    row.addSpacer(3)
    numText(row, s, size, color)
    return row
  }
  const sym = SFSymbol.named(symbol)
  if (sym) {
    sym.applyFont(Font.lightSystemFont(size))
    const img = row.addImage(sym.image)
    img.imageSize = new Size(size, size)
    img.tintColor = color
    row.addSpacer(3)
  }
  // 步數、時間的數字用英文草寫體（跟金額一樣）
  if (s) numText(row, s, size, color)
  return row
}

/** 英文／數字用草寫體 Snell Roundhand（比中文大一點才看得清楚） */
function numText(stack, s, size, color) {
  return text(stack, s, size + 3, color, script(size + 3))
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
  const cache = fm.joinPath(fm.cacheDirectory(), `ledger-widget-${SHOW_TODAY ? 'today' : 'yesterday'}.json`)
  try {
    const req = new Request(`${BASE}/widget?date=${dateKey(SHOW_DATE)}`)
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

// ── 古地圖：抓 OpenFreeMap 的向量圖磚（道路、河流、海岸、地名的座標），自己用褐色墨水畫 ──
const VT_JSON = 'https://tiles.openfreemap.org/planet'
const VT_MAX = 14 // 向量圖磚最細到 14 層，更近就放大畫（線條仍然清楚）
const VT_KEEP_DAYS = 30

/** 向量圖磚網址（從 TileJSON 讀，存一天） */
async function vtTemplate() {
  const fm = FileManager.local()
  const file = fm.joinPath(fm.cacheDirectory(), 'ledger-vt.json')
  if (fm.fileExists(file) && Date.now() - fm.modificationDate(file).getTime() < 86400000) {
    try {
      return JSON.parse(fm.readString(file)).tiles[0]
    } catch {}
  }
  try {
    const req = new Request(VT_JSON)
    req.timeoutInterval = 10
    const j = await req.loadJSON()
    if (!j.tiles || !j.tiles[0]) throw new Error('no tiles')
    fm.writeString(file, JSON.stringify({ tiles: j.tiles }))
    return j.tiles[0]
  } catch {
    if (fm.fileExists(file)) return JSON.parse(fm.readString(file)).tiles[0]
    return null
  }
}

/** 下載（或從手機讀）一塊向量圖磚，回傳 bytes */
async function loadVT(z, x, y) {
  const fm = FileManager.local()
  const dir = fm.joinPath(fm.cacheDirectory(), 'ledger-vt')
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true)
  const file = fm.joinPath(dir, `${z}-${x}-${y}.pbf`)
  if (fm.fileExists(file) && Date.now() - fm.modificationDate(file).getTime() < VT_KEEP_DAYS * 86400000) {
    const d = fm.read(file)
    if (d) return d.getBytes()
  }
  const tpl = await vtTemplate()
  if (!tpl) return null
  try {
    const req = new Request(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y))
    req.timeoutInterval = 10
    const data = await req.load()
    if (req.response.statusCode !== 200) throw new Error(String(req.response.statusCode))
    fm.write(file, data)
    return data.getBytes()
  } catch {
    if (fm.fileExists(file)) return fm.read(file).getBytes()
    return null
  }
}

/** 最小的 protobuf／Mapbox Vector Tile 解碼（只讀需要的圖層） */
function utf8(b, s, e) {
  let out = ''
  for (let i = s; i < e; ) {
    let c = b[i++]
    if (c >= 0xf0) c = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63)
    else if (c >= 0xe0) c = ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63)
    else if (c >= 0xc0) c = ((c & 31) << 6) | (b[i++] & 63)
    out += String.fromCodePoint(c)
  }
  return out
}
function decodeVT(b, want) {
  let pos = 0
  const varint = () => {
    let r = 0
    let m = 1
    let c
    do {
      c = b[pos++]
      r += (c & 127) * m
      m *= 128
    } while (c >= 128)
    return r
  }
  const skip = (wt) => {
    if (wt === 0) varint()
    else if (wt === 1) pos += 8
    else if (wt === 2) {
      const l = varint()
      pos += l
    }
    else if (wt === 5) pos += 4
  }
  const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2)
  const layers = {}
  while (pos < b.length) {
    const key = varint()
    if (key >> 3 !== 3 || (key & 7) !== 2) {
      skip(key & 7)
      continue
    }
    const end = varint() + pos
    let name = ''
    const keys = []
    const vals = []
    const feats = []
    let extent = 4096
    const lstart = pos
    // 先讀名字，不需要的圖層直接跳過
    while (pos < end) {
      const k = varint()
      if (k >> 3 === 1) {
        const l = varint()
        name = utf8(b, pos, pos + l)
        pos += l
        break
      }
      skip(k & 7)
    }
    if (!want.includes(name)) {
      pos = end
      continue
    }
    pos = lstart
    while (pos < end) {
      const k = varint()
      const f = k >> 3
      if (f === 2) {
        const fe = varint() + pos
        const feat = { tags: [], type: 0, geom: [] }
        while (pos < fe) {
          const fk = varint()
          const ff = fk >> 3
          if (ff === 2 || ff === 4) {
            const pe = varint() + pos
            const arr = ff === 2 ? feat.tags : feat.geom
            while (pos < pe) arr.push(varint())
          } else if (ff === 3) feat.type = varint()
          else skip(fk & 7)
        }
        feats.push(feat)
      } else if (f === 3) {
        const l = varint()
        keys.push(utf8(b, pos, pos + l))
        pos += l
      } else if (f === 4) {
        const ve = varint() + pos
        let v = null
        while (pos < ve) {
          const vk = varint()
          const vf = vk >> 3
          if (vf === 1) {
            const l = varint()
            v = utf8(b, pos, pos + l)
            pos += l
          } else if (vf === 4 || vf === 5) v = varint()
          else if (vf === 6) v = zz(varint())
          else if (vf === 7) v = !!varint()
          else skip(vk & 7)
        }
        vals.push(v)
      } else if (f === 5) extent = varint()
      else skip(k & 7)
    }
    layers[name] = feats.map((ft) => {
      const props = {}
      for (let i = 0; i < ft.tags.length; i += 2) props[keys[ft.tags[i]]] = vals[ft.tags[i + 1]]
      // 幾何：MoveTo／LineTo／ClosePath
      const rings = []
      let ring = null
      let x = 0
      let y = 0
      for (let i = 0; i < ft.geom.length; ) {
        const cmd = ft.geom[i] & 7
        const cnt = ft.geom[i] >> 3
        i++
        if (cmd === 7) {
          if (ring && ring.length) ring.push(ring[0])
          continue
        }
        for (let j = 0; j < cnt; j++) {
          x += zz(ft.geom[i++])
          y += zz(ft.geom[i++])
          if (cmd === 1) {
            ring = []
            rings.push(ring)
          }
          ring.push([x / extent, y / extent])
        }
      }
      return { type: ft.type, props, rings }
    })
  }
  return layers
}

const VT_LAYERS = ['water', 'waterway', 'transportation', 'boundary', 'place', 'park']
const ROAD_W = { motorway: 1.7, trunk: 1.6, primary: 1.4, secondary: 1.15, tertiary: 0.95, minor: 0.6, service: 0.4, path: 0.35, track: 0.35, rail: 0.7 }

/**
 * 在 dc 上畫古地圖：羊皮紙底、海岸線加陰影線、河、褐色墨水道路（大路是雙線）、斜體地名。
 * center＝[緯度, 經度] 畫在 (ax, ay)；zr＝要畫的縮放層級；ppx＝1 個 zr 層像素是幾點。
 * blur＝鏡片外的糊版本（線條粗而淡、地名糊）。回傳有沒有成功畫出東西。
 */
async function drawAntique(dc, center, zr, ax, ay, w, h, ppx, blur = false) {
  const zt = Math.max(0, Math.min(VT_MAX, Math.floor(zr)))
  const k = 2 ** (zr - zt) // zt 層的 1 像素＝zr 層的 k 像素
  const q = worldPx(center[0], center[1], zr)
  const left = q.x - ax / ppx
  const top = q.y - ay / ppx
  const x0 = Math.floor(left / k / 256)
  const x1 = Math.floor((left + w / ppx) / k / 256)
  const y0 = Math.floor(top / k / 256)
  const y1 = Math.floor((top + h / ppx) / k / 256)
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 9) return false
  const tiles = []
  const n = 2 ** zt
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      if (ty < 0 || ty >= n) continue
      const bytes = await loadVT(zt, ((tx % n) + n) % n, ty)
      if (bytes) tiles.push({ tx, ty, l: decodeVT(bytes, VT_LAYERS) })
    }
  if (!tiles.length) return false
  const pt = (t, c) => new Point(((t.tx + c[0]) * 256 * k - left) * ppx, ((t.ty + c[1]) * 256 * k - top) * ppx)
  const each = (layer, fn) => {
    for (const t of tiles) for (const f of t.l[layer] || []) fn(f, t)
  }
  const ink = (a) => new Color('#2A140A', a)
  const stroke = (pts, width, color) => {
    if (pts.length < 2) return
    const p = new Path()
    p.addLines(pts)
    dc.addPath(p)
    dc.setStrokeColor(color)
    dc.setLineWidth(width)
    dc.strokePath()
  }
  // 羊皮紙底
  dc.setFillColor(new Color('#E8D9B8'))
  dc.fillRect(new Rect(0, 0, w, h))
  const wide = blur ? 2.2 : 1
  // 公園：淡淡的斑點色
  each('park', (f, t) => {
    if (f.type !== 3) return
    const p = new Path()
    for (const r of f.rings) p.addLines(r.map((c) => pt(t, c)))
    dc.addPath(p)
    dc.setFillColor(new Color('#C9B98E', 0.35))
    dc.fillPath()
  })
  // 水：稍深的底色＋海岸線一圈圈往外淡掉（舊地圖的陰影線感）
  each('water', (f, t) => {
    if (f.type !== 3) return
    const rings = f.rings.map((r) => r.map((c) => pt(t, c)))
    const p = new Path()
    for (const r of rings) p.addLines(r)
    dc.addPath(p)
    dc.setFillColor(new Color('#D6C49C'))
    dc.fillPath()
    for (const r of rings) {
      for (const [lw, a] of [[7 * wide, 0.05], [4 * wide, 0.08], [2.2 * wide, 0.12]]) stroke(r, lw, ink(a))
      stroke(r, (blur ? 2 : 0.9) * 1, ink(blur ? 0.25 : 0.8))
    }
  })
  each('waterway', (f, t) => {
    for (const r of f.rings) stroke(r.map((c) => pt(t, c)), (f.props.class === 'river' ? 1.4 : 0.6) * wide, ink(blur ? 0.25 : 0.6))
  })
  each('boundary', (f, t) => {
    if ((f.props.admin_level || 99) > 6) return
    for (const r of f.rings) stroke(r.map((c) => pt(t, c)), 0.8 * wide, ink(blur ? 0.15 : 0.35))
  })
  // 道路：大路畫成雙線（墨線＋中間紙色），小路單線
  const roads = []
  each('transportation', (f, t) => {
    if (f.type !== 2) return
    const wdt = ROAD_W[f.props.class]
    if (!wdt) return
    if ((zr < 13 || blur) && wdt < 0.9) return // 遠看、糊的版本只畫大路
    for (const r of f.rings) roads.push({ pts: r.map((c) => pt(t, c)), wdt, cls: f.props.class })
  })
  const zs = Math.max(0.6, Math.min(1.6, 2 ** ((zr - 15) / 2)))
  for (const r of roads) {
    const lw = r.wdt * zs * wide
    if (blur) {
      stroke(r.pts, lw * 4, ink(0.05))
      stroke(r.pts, lw * 2.2, ink(0.07))
    }
    else if (r.wdt >= 1.1) stroke(r.pts, lw * 2.1, ink(0.92))
    else stroke(r.pts, lw, ink(0.78))
  }
  if (!blur) for (const r of roads) if (r.wdt >= 1.1) stroke(r.pts, r.wdt * zs * 1.1, new Color('#EBDDBD'))
  // 地名：斜體襯線字（糊版本畫幾次錯開、很淡）
  const shown = []
  each('place', (f, t) => {
    const name = f.props['name:zh'] || f.props.name_zh || f.props.name
    if (!name || f.type !== 1 || !f.rings[0]) return
    const c = pt(t, f.rings[0][0])
    if (c.x < -20 || c.y < 0 || c.x > w + 20 || c.y > h) return
    if (shown.some((s) => Math.abs(s.x - c.x) < 40 && Math.abs(s.y - c.y) < 14)) return
    shown.push(c)
    const big = ['city', 'town'].includes(f.props.class)
    dc.setFont(serif(big ? 11 : 8.5, 'Italic'))
    dc.setTextAlignedCenter()
    const r = new Rect(c.x - 40, c.y - 6, 80, 14)
    if (blur) {
      dc.setTextColor(ink(0.18))
      for (const [ox, oy] of [[-0.8, 0], [0.8, 0], [0, -0.8], [0, 0.8]]) dc.drawTextInRect(name, new Rect(r.x + ox, r.y + oy, r.width, r.height))
    } else {
      dc.setTextColor(ink(0.95))
      dc.drawTextInRect(name, r)
    }
  })
  return true
}

// ── 地圖卡片：模糊的地圖上放一支放大鏡，鏡片裡是清楚的地圖 ──
// 放大鏡圖（magnifier.png）跟卡片一樣大，位置要跟 make-widget-art.py 的 CARD、LENS 一樣
const CARD = { w: 140, h: 132 }
const LENS = { cx: 80, cy: 55, r: 38 } // r＝鏡片（玻璃）半徑，比挖空的洞大 1 點，蓋住接縫
/** 完全沒有定位時，放大鏡下放一張台灣地圖 */
const DEFAULT_VIEW = { center: [23.75, 120.95], z: 7, route: null, pin: false }

/** 地圖要看哪裡：中心點、鏡片裡的縮放層級、路線 */
function mapView(route) {
  if (!route.length) return DEFAULT_VIEW
  if (moved(route)) {
    const inner = LENS.r * 2 - 18
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
    return { center: [(Math.max(...lats) + Math.min(...lats)) / 2, (Math.max(...lngs) + Math.min(...lngs)) / 2], z, route, pin: true }
  }
  return { center: route[route.length - 1], z: 16, route: null, pin: true }
}

/** 老地圖效果：蓋上 oldmap.png（泛黃褪色、紙紋、摺痕、四周變暗）；(ox, oy) 是這張圖在卡片上的位置。下載不到就蓋一層泛黃色 */
async function ageMap(dc, ox, oy, w, h) {
  const over = await loadArt('oldmap.png')
  if (over) {
    dc.drawImageInRect(over, new Rect(-ox, -oy, CARD.w, CARD.h))
    return
  }
  dc.setFillColor(new Color('#B08C5C', 0.5))
  dc.fillRect(new Rect(0, 0, w, h))
}

/** 把點連成平滑的曲線（Chaikin），筆畫起來比較順 */
function smooth(pts, times = 2) {
  let p = pts
  for (let t = 0; t < times && p.length > 2; t++) {
    const out = [p[0]]
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]
      const b = p[i + 1]
      out.push(new Point(a.x * 0.75 + b.x * 0.25, a.y * 0.75 + b.y * 0.25), new Point(a.x * 0.25 + b.x * 0.75, a.y * 0.25 + b.y * 0.75))
    }
    out.push(p[p.length - 1])
    p = out
  }
  return p
}

const INK = '#2E170A'

/** 手抖一點的線：每個點沿垂直方向偏一點點 */
function wobble(pts, amp, seed) {
  const r = rand(seed)
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const k = (r() - 0.5) * 2 * amp
    return new Point(p.x - ((b.y - a.y) / len) * k, p.y + ((b.x - a.x) / len) * k)
  })
}

function strokeLine(dc, pts, width, color) {
  const p = new Path()
  p.addLines(pts)
  dc.addPath(p)
  dc.setStrokeColor(color)
  dc.setLineWidth(width)
  dc.strokePath()
}

/** 用鋼筆畫的路線：主線＋一道淡淡的第二筆（墨水不均）＋起點墨點＋終點手畫圈 */
function inkRoute(dc, pts) {
  // 先在原本的點上抖一點點，再畫成平滑曲線（像手拿筆描）
  strokeLine(dc, smooth(wobble(pts, 0.6, 3), 3), 2.1, new Color(INK, 0.88))
  strokeLine(dc, smooth(wobble(pts, 1.0, 9), 3), 0.9, new Color(INK, 0.4))
  const s0 = pts[0]
  circle(dc, s0.x, s0.y, 2.6, new Color(INK, 0.9))
  inkCircle(dc, pts[pts.length - 1], 6.5)
}

/** 手畫的圈（轉一圈多一點、頭尾沒接好）＋中間一個墨點 */
function inkCircle(dc, c, rad) {
  const r = rand(17)
  const pts = []
  for (let i = 0; i <= 30; i++) {
    const t = -0.6 + (i / 30) * Math.PI * 2.25
    const rr = rad * (1 + (r() - 0.5) * 0.12 + i * 0.004)
    pts.push(new Point(c.x + Math.cos(t) * rr, c.y + Math.sin(t) * rr * 0.92))
  }
  strokeLine(dc, pts, 1.6, new Color(INK, 0.85))
  circle(dc, c.x, c.y, 1.8, new Color(INK, 0.9))
}

/** 鏡片外（模糊地圖上）的路線：好幾層淡淡的粗線疊出糊糊的墨跡 */
function blurryRoute(dc, pts) {
  const sm = smooth(pts)
  for (const [w, a] of [[7, 0.05], [5, 0.07], [3.5, 0.09], [2.2, 0.1]]) strokeLine(dc, sm, w, new Color(INK, a))
}

/** 右下角的地名小紙片：撕邊的舊紙＋淡淡的影子（畫在卡片底圖上） */
const TAG = { w: 106, h: 30, right: 5, bottom: 7 } // 卷軸標籤 tag.png 的大小要跟 make-widget-art.py 一樣
function drawTag(dc) {
  const { w, h } = CARD
  const x0 = w - TAG.right - TAG.w
  const y0 = h - TAG.bottom - TAG.h
  const r = rand(97)
  const pts = []
  // 上下兩邊撕得不規則，左右直的
  for (let x = 0; x <= TAG.w; x += 3) pts.push(new Point(x0 + x, y0 + r() * 1.8))
  for (let x = TAG.w; x >= 0; x -= 3) pts.push(new Point(x0 + x, y0 + TAG.h - r() * 1.8))
  const shadow = new Path()
  shadow.addLines(pts.map((p) => new Point(p.x + 1.2, p.y + 1.8)))
  shadow.closeSubpath()
  dc.addPath(shadow)
  dc.setFillColor(new Color('#2A1A0E', 0.25))
  dc.fillPath()
  const tag = new Path()
  tag.addLines(pts)
  tag.closeSubpath()
  dc.addPath(tag)
  dc.setFillColor(new Color('#E4D6BA'))
  dc.fillPath()
  // 紙片上的斑點與邊緣泛黃
  for (let i = 0; i < 14; i++) circle(dc, x0 + r() * TAG.w, y0 + r() * TAG.h, 0.5 + r() * 1.2, new Color('#8A6236', 0.08 + r() * 0.08))
  dc.addPath(tag)
  dc.setStrokeColor(new Color('#9C7A52', 0.55))
  dc.setLineWidth(0.6)
  dc.strokePath()
}

/** 卡片底圖：模糊的地圖（用低 4 層的圖磚放大 16 倍，自然就糊了）＋舊地圖色調＋放大鏡＋地名紙片 */
async function cardBackground(view) {
  const { w, h } = CARD
  const { cx, cy } = LENS
  const dc = canvas(w, h)
  dc.setFillColor(C.tile)
  dc.fillRect(new Rect(0, 0, w, h))
  const bz = Math.max(1, view.z - 2) // 外面看到的範圍比鏡片大 4 倍
  // 先試古地圖（向量）；抓不到就用一般圖磚放大變糊
  const antique = await drawAntique(dc, view.center, bz, cx, cy, w, h, TILE_PT, true)
  const dz = antique ? bz : Math.max(0, bz - 4)
  const ppx = TILE_PT * 2 ** (bz - dz)
  const q = worldPx(view.center[0], view.center[1], dz)
  const left = q.x - cx / ppx
  const top = q.y - cy / ppx
  if (!antique) await drawTiles(dc, dz, left, top, w, h, ppx)
  // 鏡片外也看得到路線（糊的）
  if (view.route) {
    blurryRoute(dc, view.route.map((p) => {
      const t = worldPx(p[0], p[1], dz)
      return new Point((t.x - left) * ppx, (t.y - top) * ppx)
    }))
  }
  await ageMap(dc, 0, 0, w, h)
  // 撕邊框（外面是背景紙的同一塊，邊緣焦黃、捲角）
  const frame = await loadArt('mapframe.png')
  if (frame) dc.drawImageInRect(frame, new Rect(0, 0, w, h))
  const mag = await loadArt('magnifier.png')
  if (mag) dc.drawImageInRect(mag, new Rect(0, 0, w, h))
  // 右下角卷軸標籤（字由 rightCard 疊上去）
  const tag = await loadArt('tag.png')
  if (tag) dc.drawImageInRect(tag, new Rect(w - TAG.right - TAG.w, h - TAG.bottom - TAG.h, TAG.w, TAG.h))
  else drawTag(dc)
  return dc.getImage()
}

/** 鏡片裡：清楚的地圖、路線或目前位置，上面蓋玻璃反光（外面會被裁成圓形） */
async function lensImage(view) {
  const d = LENS.r * 2
  const dc = canvas(d, d)
  dc.setFillColor(C.soft)
  dc.fillRect(new Rect(0, 0, d, d))
  // 放大鏡把地圖放大一點：同一層圖磚畫成 1.25 倍
  const ppx = TILE_PT * 1.25
  const q = worldPx(view.center[0], view.center[1], view.z)
  const left = q.x - d / 2 / ppx
  const top = q.y - d / 2 / ppx
  if (!(await drawAntique(dc, view.center, view.z, d / 2, d / 2, d, d, ppx))) await drawTiles(dc, view.z, left, top, d, d, ppx)
  await ageMap(dc, LENS.cx - LENS.r, LENS.cy - LENS.r, d, d)
  const toPt = (p) => {
    const w = worldPx(p[0], p[1], view.z)
    return new Point((w.x - left) * ppx, (w.y - top) * ppx)
  }
  if (view.route) inkRoute(dc, view.route.map(toPt))
  else if (view.pin) inkCircle(dc, toPt(view.center), 8)
  const g = await loadArt('glass.png')
  if (g) dc.drawImageInRect(g, new Rect(0, 0, d, d))
  return dc.getImage()
}

async function errorWidget(msg) {
  const w = new ListWidget()
  await paintBg(w, config.widgetFamily === 'small' ? 'small' : 'medium')
  w.setPadding(18, 20, 18, 20)
  text(w, '摳摳手帳', 14, C.primary, Font.semiboldSystemFont(14))
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

/** 第一行：草寫英文日期 */
function headerRows(stack) {
  text(stack, dayLabel(SHOW_DATE), 13, C.primary, script(13))
}

/** 金額下面的小字：今日支出・今天幾筆（昨日回顧：昨日支出・共幾件） */
async function countLine(stack, d) {
  const n = d.todayCount || 0
  if (!SHOW_TODAY) return cnText(stack, `昨日支出　共 ${n} 件`, 10, C.sub)
  await cnText(stack, n ? `今日支出　今天共 ${n} 件` : '今日支出　今日尚未支出', 10, C.sub)
}

/** 本月：分隔線（或預算進度線）＋金額 */
async function monthBlock(stack, d, width, showLeft = true) {
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
  await cnText(row, MONTH_WORD, 11, C.sub)
  row.addSpacer(5)
  text(row, money(d.monthExpense), 14, C.text, script(14))
  if (BUDGET > 0 && showLeft) {
    row.addSpacer()
    const left = BUDGET - d.monthExpense
    const lc = left >= 0 ? C.sub : C.over
    await cnText(row, left >= 0 ? '剩' : '超出', 11, lc)
    row.addSpacer(3)
    numText(row, money(Math.abs(left)), 11, lc)
  }
}

/** 最下面一列：步數、最後定位時間、離線 */
async function infoRow(stack, d, stale) {
  const row = stack.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  let any = false
  if (d.steps != null) {
    await iconText(row, 'footprints', d.steps.toLocaleString('en-US'), 10, C.sub)
    any = true
  }
  // 最後定位時間只在看今天時有意義
  if (d.lastTime && SHOW_TODAY) {
    if (any) row.addSpacer(9)
    await iconText(row, 'location', hm(d.lastTime), 10, C.sub)
    any = true
  }
  if (stale) {
    if (any) row.addSpacer(9)
    await iconText(row, 'wifi.slash', '', 10, C.over) // 只留圖示（「離線」兩字不在行書字形裡）
  }
}

/** 右邊地圖卡片：模糊地圖＋放大鏡（有移動＝路線；沒移動＝目前位置；沒有點＝台灣），右下角紙片寫距離或「在此」 */
async function rightCard(row, d) {
  const route = d.route || []
  const view = mapView(route)
  // 不寫地名（地名的字不在手寫字形裡）
  const top = DAY_WORD
  let main = '未留足印'
  if (view.route) main = `走了 ${routeKm(route).toFixed(1)} km`
  else if (view.pin) main = '在此'
  const { cx, cy, r } = LENS
  const card = row.addStack()
  card.size = new Size(CARD.w, CARD.h)
  card.backgroundImage = await cardBackground(view) // 方形卡片，撕邊效果畫在圖裡
  card.layoutVertically()
  card.addSpacer(cy - r)
  const lensRow = card.addStack()
  lensRow.addSpacer(cx - r)
  const glass = lensRow.addStack()
  glass.size = new Size(r * 2, r * 2)
  glass.cornerRadius = r
  glass.backgroundImage = await lensImage(view)
  lensRow.addSpacer()
  card.addSpacer()
  // 紙片上的字（紙片本身畫在底圖上）
  const capRow = card.addStack()
  capRow.addSpacer()
  // 一行置中寫在皺紙片上：「今天走了 1.1 km」「今天在此」「今天未留足印」
  const cap = capRow.addStack()
  cap.layoutHorizontally()
  cap.centerAlignContent()
  cap.size = new Size(TAG.w, TAG.h)
  cap.setPadding(1, 8, 0, 8)
  cap.addSpacer()
  await cnText(cap, top + main, 10.5, C.text)
  cap.addSpacer()
  capRow.addSpacer(TAG.right)
  card.addSpacer(TAG.bottom)
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
  text(left, money(d.todayExpense), 30, C.text, script(30))
  await countLine(left, d)
  left.addSpacer()
  await monthBlock(left, d, 150)
  left.addSpacer(5)
  await infoRow(left, d, stale)
  row.addSpacer()
  await rightCard(row, d)
  return w
}

async function smallWidget(d, stale) {
  const w = new ListWidget()
  await paintBg(w, 'small')
  w.setPadding(18, 20, 16, 20)
  headerRows(w)
  text(w, money(d.todayExpense), 28, C.text, script(28))
  await countLine(w, d)
  w.addSpacer()
  await monthBlock(w, d, 118, false)
  w.addSpacer(5)
  await infoRow(w, d, stale)
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
  await cnText(w, '一年前的今天', 12, photo ? Color.white() : C.primary)
  await cnText(w, ya.date.replace(/^(\d+)-(\d+)-(\d+)$/, (_, y, m, dd) => `${y}年${+m}月${+dd}日`), 10, sub)
  w.addSpacer()
  const line = ya.summary || ya.notes[0]?.note || ya.notes[0]?.title || (ya.count ? `${ya.count} 則紀錄` : '這天沒有紀錄')
  const t = w.addText(line)
  t.font = Font.mediumSystemFont(13)
  t.textColor = fg
  t.lineLimit = 3
  if (ya.expense > 0) await cnText(w, `花了 ${money(ya.expense)}`, 10, sub)
  return w
}

function accessoryWidget(d) {
  const w = new ListWidget()
  text(w, `${DAY_SHORT} ${money(d.todayExpense)}`, 14, Color.white(), Font.boldSystemFont(14))
  text(w, BUDGET > 0 ? `${MONTH_WORD} ${Math.round((d.monthExpense / BUDGET) * 100)}% 預算` : `${MONTH_WORD} ${money(d.monthExpense)}`, 12, Color.white())
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

/**
 * 下次更新：看今天＝15 分鐘後；昨日回顧＝只在 00:10（換日）、09:00、13:00、19:00
 * （昨天的步數要等捷徑隔天送，晚記的帳也補得到），一天 4 次，不會用掉 iOS 給的更新次數。
 */
function nextRefresh() {
  const now = new Date()
  if (SHOW_TODAY) return new Date(now.getTime() + 15 * 60 * 1000)
  for (const [h, m] of [[0, 10], [9, 0], [13, 0], [19, 0], [24, 10]]) {
    const t = new Date(now)
    t.setHours(h, m, 0, 0)
    if (t > now) return t
  }
}

async function main() {
const family = config.widgetFamily || 'medium'
const param = PARAM
const res = await load()
let widget
if (res.error) widget = await errorWidget(res.error)
else if (/一年前|year/i.test(param)) widget = await yearAgoWidget(res.data)
else if (family.startsWith('accessory')) widget = accessoryWidget(res.data)
else if (family === 'small') widget = await smallWidget(res.data, res.stale)
else widget = await mediumWidget(res.data, res.stale)
widget.url = URLScheme.forRunningScript() + '?open=1'
widget.refreshAfterDate = nextRefresh()

if (config.runsInWidget || config.runsInAccessoryWidget) {
  Script.setWidget(widget)
} else if (/一年前|year/i.test(param) || family === 'small') {
  await widget.presentSmall()
} else {
  await widget.presentMedium()
}
Script.complete()
}
