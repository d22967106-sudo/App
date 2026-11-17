import { describe, expect, it } from 'vitest'
import { parseAreaQuery } from './areaQuery'

describe('地區＋店名解析', () => {
  it('縣市簡稱開頭：嘉義同時代表嘉義市與嘉義縣', () => {
    expect(parseAreaQuery('嘉義幸福')).toEqual({
      area: { label: '嘉義', queries: ['嘉義市', '嘉義縣'], taiwan: true },
      shop: '幸福',
    })
  })

  it('台／臺都可以，全名優先', () => {
    expect(parseAreaQuery('台北鼎泰豐')?.area).toEqual({ label: '台北', queries: ['臺北市'], taiwan: true })
    expect(parseAreaQuery('新竹市阿忠冰店')).toMatchObject({ area: { queries: ['新竹市'] }, shop: '阿忠冰店' })
    expect(parseAreaQuery('馬祖老酒')).toMatchObject({ area: { queries: ['連江縣'] }, shop: '老酒' })
  })

  it('縣市＋鄉鎮市區，查不到區時退回整個縣市', () => {
    const r = parseAreaQuery('嘉義市東區幸福')!
    expect(r.area).toEqual({ label: '嘉義市東區', queries: ['東區, 嘉義市'], taiwan: true })
    expect(r.shop).toBe('幸福')
    expect(r.fallback).toEqual({ area: { label: '嘉義市', queries: ['嘉義市'], taiwan: true }, shop: '東區幸福' })
    // 店名剛好像區名（幸福市集）：先試「幸福市」，找不到就整個嘉義找「幸福市集」
    expect(parseAreaQuery('嘉義幸福市集')!.fallback!.shop).toBe('幸福市集')
  })

  it('空格隔開：前面可以是任何地名', () => {
    expect(parseAreaQuery('京都 茶寮都路里')).toEqual({
      area: { label: '京都', queries: ['京都'], taiwan: false },
      shop: '茶寮都路里',
    })
    expect(parseAreaQuery('嘉義 幸福')?.area.queries).toEqual(['嘉義市', '嘉義縣'])
  })

  it('不是地區開頭、或只有地名，回傳 null', () => {
    expect(parseAreaQuery('幸福')).toBeNull()
    expect(parseAreaQuery('鼎泰豐')).toBeNull()
    expect(parseAreaQuery('嘉義')).toBeNull()
    expect(parseAreaQuery('  ')).toBeNull()
  })
})
