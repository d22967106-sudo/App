/**
 * 「地區＋店名」搜尋的解析：
 *   嘉義幸福          → 在嘉義（嘉義市＋嘉義縣）找「幸福」
 *   嘉義市東區幸福    → 在嘉義市東區找「幸福」（找不到東區就退回整個嘉義市）
 *   京都 抹茶         → 用空格隔開，前面可以是任何地名（含國外）
 *   幸福              → 不是地區開頭，回傳 null（照舊搜附近）
 */

/** 台灣 22 個縣市 */
export const TW_COUNTIES = [
  '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣',
  '南投縣', '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
]

/** 別名 → 對應的縣市（「嘉義」同時代表嘉義市和嘉義縣） */
const ALIASES: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>()
  const add = (alias: string, county: string) => {
    const list = m.get(alias) ?? []
    if (!list.includes(county)) list.push(county)
    m.set(alias, list)
  }
  for (const c of TW_COUNTIES) {
    add(c, c)
    add(c.slice(0, -1), c) // 去掉「市／縣」
  }
  add('馬祖', '連江縣')
  return m
})()

/** 長的先比對，避免「新竹市」被「新竹」先吃掉 */
const ALIAS_KEYS = [...ALIASES.keys()].sort((a, b) => b.length - a.length)

/** 開頭的「台」視為「臺」（只用來比對，長度不變） */
const normalize = (s: string) => s.replace(/^台/, '臺')

export interface AreaTarget {
  /** 顯示給使用者看的地區名稱（使用者打的字） */
  label: string
  /** 要合併範圍的 Nominatim 查詢字串 */
  queries: string[]
  /** 是否限定台灣 */
  taiwan: boolean
}

export interface AreaQuery {
  area: AreaTarget
  shop: string
  /** 鄉鎮市區查不到時改用的範圍（整個縣市，店名包含原本當成區名的字） */
  fallback?: { area: AreaTarget; shop: string }
}

function countyArea(label: string, counties: string[]): AreaTarget {
  return { label, queries: counties, taiwan: true }
}

export function parseAreaQuery(text: string): AreaQuery | null {
  const t = text.trim()
  if (!t) return null

  // 1. 用空格隔開：前面是地區，後面是店名
  const sp = /^(\S+)\s+(.+)$/.exec(t)
  if (sp) {
    const [, area, shop] = sp
    const counties = ALIASES.get(normalize(area))
    return {
      area: counties ? countyArea(area, counties) : { label: area, queries: [area], taiwan: false },
      shop: shop.trim(),
    }
  }

  // 2. 縣市開頭
  const n = normalize(t)
  const alias = ALIAS_KEYS.find((a) => n.startsWith(a))
  if (!alias) return null
  const counties = ALIASES.get(alias)!
  const countyLabel = t.slice(0, alias.length)
  const rest = t.slice(alias.length)
  if (!rest) return null
  const county = countyArea(countyLabel, counties)

  // 3. 縣市後面接鄉鎮市區（最多 3 個字＋區／鄉／鎮／市）
  const d = /^(.{1,3}?[區鄉鎮市])(.+)$/.exec(rest)
  if (d) {
    const [, district, shop] = d
    return {
      area: { label: countyLabel + district, queries: counties.map((c) => `${district}, ${c}`), taiwan: true },
      shop,
      fallback: { area: county, shop: rest },
    }
  }
  return { area: county, shop: rest }
}
