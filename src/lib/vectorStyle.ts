/**
 * OpenFreeMap（免費、免金鑰）的向量地圖樣式處理：
 * - 把地名改成優先顯示繁體中文
 * - 「奶茶淡色」：依 OpenMapTiles 的圖層種類（source-layer）重新上色成焦糖奶茶配色
 */

type Json = Record<string, unknown>

export interface StyleLayer {
  id: string
  type: string
  'source-layer'?: string
  paint?: Json
  layout?: Json
  [k: string]: unknown
}

export interface StyleSpec {
  version: number
  layers: StyleLayer[]
  [k: string]: unknown
}

/** 焦糖奶茶地圖配色（對應 docs/plan.md 第 4 節與預覽圖） */
export const WARM = {
  background: '#EEDFCC',
  park: '#E0DDBF',
  landuse: '#E8D6C0',
  water: '#D9E2E4',
  building: '#E5D3BF',
  buildingLine: '#DAC5AE',
  road: '#FFFFFF',
  roadCasing: '#E2CDB6',
  rail: '#CDB8A1',
  boundary: '#C4AE98',
  text: '#7D6450',
  textStrong: '#3A2618',
  halo: '#F7EFE5',
}

/** 中文優先的地名：繁中 → 中文 → 當地名稱 */
export const ZH_NAME = ['coalesce', ['get', 'name:zh-Hant'], ['get', 'name:zh'], ['get', 'name']]

function usesName(textField: unknown): boolean {
  return JSON.stringify(textField ?? '').includes('name')
}

/** 地名改成中文優先（道路編號等不含 name 的標籤不動） */
export function withChineseLabels(style: StyleSpec): StyleSpec {
  return {
    ...style,
    layers: style.layers.map((l) => {
      if (l.type !== 'symbol' || !l.layout || !usesName(l.layout['text-field'])) return l
      return { ...l, layout: { ...l.layout, 'text-field': ZH_NAME } }
    }),
  }
}

const GREEN = /park|wood|forest|grass|scrub|garden|golf|pitch|cemetery|meadow|farmland|nature|wetland/

function recolor(l: StyleLayer): StyleLayer {
  const src = l['source-layer'] ?? ''
  const id = l.id.toLowerCase()
  const paint: Json = { ...(l.paint ?? {}) }
  const set = (k: string, v: unknown) => {
    paint[k] = v
  }

  if (l.type === 'background') {
    set('background-color', WARM.background)
  } else if (l.type === 'fill' || l.type === 'fill-extrusion') {
    delete paint['fill-pattern']
    const key = l.type === 'fill' ? 'fill-color' : 'fill-extrusion-color'
    if (src === 'water') set(key, WARM.water)
    else if (src === 'park' || GREEN.test(id) || src === 'landcover') set(key, WARM.park)
    else if (src === 'building') {
      set(key, WARM.building)
      if (l.type === 'fill') set('fill-outline-color', WARM.buildingLine)
    } else if (src === 'landuse' || src === 'aeroway') set(key, WARM.landuse)
    else if (src === 'transportation') set(key, WARM.road)
  } else if (l.type === 'line') {
    if (src === 'water' || src === 'waterway') set('line-color', WARM.water)
    else if (src === 'transportation') {
      if (/rail|transit|subway|ferry/.test(id)) set('line-color', WARM.rail)
      else if (/casing|outline/.test(id)) set('line-color', WARM.roadCasing)
      else set('line-color', WARM.road)
    } else if (src === 'boundary') set('line-color', WARM.boundary)
    else if (src === 'building') set('line-color', WARM.buildingLine)
    else if (src === 'park' || src === 'landcover') set('line-color', WARM.park)
  } else if (l.type === 'symbol') {
    if (paint['text-color'] !== undefined || l.layout?.['text-field'] !== undefined) {
      const strong = src === 'place' && /city|capital|country|state|town/.test(id)
      set('text-color', strong ? WARM.textStrong : WARM.text)
      set('text-halo-color', WARM.halo)
      set('text-halo-width', 1.4)
    }
  }
  return { ...l, paint }
}

/** 奶茶淡色：重新上色＋中文地名 */
export function warmStyle(style: StyleSpec): StyleSpec {
  const zh = withChineseLabels(style)
  return { ...zh, layers: zh.layers.map(recolor) }
}

/** 預覽小圖（向量地圖沒有單張圖磚可以當預覽，用色塊示意） */
export function previewSvg(c: { bg: string; park: string; water: string; road: string; casing: string }): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
<rect width="200" height="120" fill="${c.bg}"/>
<rect x="12" y="10" width="54" height="44" rx="10" fill="${c.park}"/>
<rect x="140" y="62" width="48" height="46" rx="10" fill="${c.park}"/>
<path d="M-10 92 C 40 74, 80 104, 130 84 S 190 60, 210 70" stroke="${c.water}" stroke-width="16" fill="none"/>
<path d="M0 66 L200 40" stroke="${c.casing}" stroke-width="10" fill="none"/>
<path d="M0 66 L200 40" stroke="${c.road}" stroke-width="7" fill="none"/>
<path d="M86 0 L98 120" stroke="${c.casing}" stroke-width="10" fill="none"/>
<path d="M86 0 L98 120" stroke="${c.road}" stroke-width="7" fill="none"/>
<path d="M0 24 L200 16" stroke="${c.road}" stroke-width="4" fill="none"/>
<path d="M150 0 L156 120" stroke="${c.road}" stroke-width="4" fill="none"/>
</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
