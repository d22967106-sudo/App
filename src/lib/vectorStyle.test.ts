import { describe, expect, it } from 'vitest'
import { WARM, ZH_NAME, warmStyle, withChineseLabels, type StyleSpec } from './vectorStyle'

const sample: StyleSpec = {
  version: 8,
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
    { id: 'water', type: 'fill', 'source-layer': 'water', paint: { 'fill-color': 'blue' } },
    { id: 'park', type: 'fill', 'source-layer': 'park', paint: { 'fill-color': 'green', 'fill-pattern': 'x' } },
    { id: 'landcover_wood', type: 'fill', 'source-layer': 'landcover', paint: {} },
    { id: 'building', type: 'fill', 'source-layer': 'building', paint: {} },
    { id: 'highway_major_casing', type: 'line', 'source-layer': 'transportation', paint: { 'line-width': 3 } },
    { id: 'highway_major', type: 'line', 'source-layer': 'transportation', paint: {} },
    { id: 'railway', type: 'line', 'source-layer': 'transportation', paint: {} },
    {
      id: 'place_city',
      type: 'symbol',
      'source-layer': 'place',
      layout: { 'text-field': ['get', 'name:latin'] },
      paint: { 'text-color': '#000' },
    },
    {
      id: 'road_shield',
      type: 'symbol',
      'source-layer': 'transportation_name',
      layout: { 'text-field': '{ref}' },
      paint: {},
    },
  ],
}

const byId = (s: StyleSpec, id: string) => s.layers.find((l) => l.id === id)!

describe('向量地圖樣式', () => {
  it('地名改成中文優先，道路編號不動', () => {
    const s = withChineseLabels(sample)
    expect(byId(s, 'place_city').layout!['text-field']).toEqual(ZH_NAME)
    expect(byId(s, 'road_shield').layout!['text-field']).toBe('{ref}')
    // 不改到原本的物件
    expect(byId(sample, 'place_city').layout!['text-field']).toEqual(['get', 'name:latin'])
  })

  it('奶茶淡色依圖層種類上色', () => {
    const s = warmStyle(sample)
    expect(byId(s, 'background').paint!['background-color']).toBe(WARM.background)
    expect(byId(s, 'water').paint!['fill-color']).toBe(WARM.water)
    expect(byId(s, 'park').paint!['fill-color']).toBe(WARM.park)
    expect(byId(s, 'park').paint!['fill-pattern']).toBeUndefined()
    expect(byId(s, 'landcover_wood').paint!['fill-color']).toBe(WARM.park)
    expect(byId(s, 'building').paint!['fill-color']).toBe(WARM.building)
    expect(byId(s, 'highway_major_casing').paint).toEqual({ 'line-width': 3, 'line-color': WARM.roadCasing })
    expect(byId(s, 'highway_major').paint!['line-color']).toBe(WARM.road)
    expect(byId(s, 'railway').paint!['line-color']).toBe(WARM.rail)
    expect(byId(s, 'place_city').paint!['text-color']).toBe(WARM.textStrong)
    expect(byId(s, 'place_city').layout!['text-field']).toEqual(ZH_NAME)
  })
})
