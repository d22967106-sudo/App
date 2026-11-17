import { describe, expect, it } from 'vitest'
import { parseSharedPlace } from './sharedPlace'
import { formatAddress, parseTwAddress, stripHouseNumber } from './geocode'

describe('從地圖 App 分享貼上', () => {
  it('Google 地圖分享文字：店名＋地址＋短網址', () => {
    expect(parseSharedPlace('幸福早午餐\n600嘉義市東區中山路123號\nhttps://maps.app.goo.gl/xQJSp3RTbsn29qG16?g_st=ic')).toEqual({
      name: '幸福早午餐',
      address: '嘉義市東區中山路123號',
    })
  })

  it('單行輸入框貼上時換行被吃掉，從縣市名切開', () => {
    expect(parseSharedPlace('幸福早午餐600嘉義市東區中山路123號https://maps.app.goo.gl/xQJSp3RTbsn29qG16?g_st=ic')).toEqual({
      name: '幸福早午餐',
      address: '嘉義市東區中山路123號',
    })
    expect(parseSharedPlace('鼎泰豐台北市信義區市府路45號https://maps.app.goo.gl/abc')).toEqual({
      name: '鼎泰豐',
      address: '台北市信義區市府路45號',
    })
  })

  it('只有短網址：沒有店名也沒有地址', () => {
    expect(parseSharedPlace('https://maps.app.goo.gl/xQJSp3RTbsn29qG16?g_st=ic')).toEqual({})
  })

  it('完整網址裡的座標', () => {
    expect(
      parseSharedPlace('鼎泰豐 https://www.google.com/maps/place/鼎泰豐/@25.0330,121.5654,17z/data=!3d25.0331!4d121.5655'),
    ).toMatchObject({ name: '鼎泰豐', lat: 25.0331, lng: 121.5655 })
    expect(parseSharedPlace('https://maps.apple.com/?ll=23.48,120.45&q=幸福')).toMatchObject({ lat: 23.48, lng: 120.45 })
  })

  it('一般文字不是分享', () => {
    expect(parseSharedPlace('幸福早午餐')).toBeNull()
  })
})

describe('地址', () => {
  it('台灣地址格式', () => {
    expect(
      formatAddress({ city: '嘉義市', city_district: '東區', road: '中山路', house_number: '123', country_code: 'tw' }),
    ).toBe('嘉義市東區中山路123號')
    expect(formatAddress({ county: '嘉義縣', town: '民雄鄉', road: '建國路', country_code: 'tw' })).toBe('嘉義縣民雄鄉建國路')
  })

  it('國外地址格式', () => {
    expect(formatAddress({ house_number: '12', road: 'Main St', city: 'Kyoto', country_code: 'jp' })).toBe('12 Main St, Kyoto')
  })

  it('門牌查不到時去掉門牌改找那條路', () => {
    expect(stripHouseNumber('嘉義市東區中山路 123 號')).toBe('嘉義市東區中山路')
    expect(stripHouseNumber('台北市信義區松仁路100巷5號3樓')).toBe('台北市信義區松仁路')
  })
})

describe('拆解台灣地址', () => {
  it('去掉郵遞區號與村里', () => {
    expect(parseTwAddress('600嘉義市東區芳草里芳安路3號')).toEqual({
      county: '嘉義市', district: '東區', road: '芳安路', number: '3', clean: '嘉義市東區芳安路3號',
    })
  })
  it('段、之、樓、鄰、台寫法', () => {
    expect(parseTwAddress('台北市大安區新生南路三段100之2號5樓')).toMatchObject({
      county: '臺北市', district: '大安區', road: '新生南路三段', number: '100之2',
    })
    expect(parseTwAddress('嘉義縣民雄鄉東榮村12鄰建國路一段8號')).toMatchObject({
      county: '嘉義縣', district: '民雄鄉', road: '建國路一段', number: '8',
    })
  })
  it('不是台灣地址就原樣', () => {
    expect(parseTwAddress('1-2-3 Gion, Kyoto').road).toBeUndefined()
  })
})
