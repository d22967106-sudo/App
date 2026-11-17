import { roundMoney } from './ledger'

export interface CurrencyInfo {
  code: string
  name: string
  symbol: string
  /** 顯示的小數位數 */
  digits: number
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'TWD', name: '新台幣', symbol: 'NT$', digits: 0 },
  { code: 'JPY', name: '日圓', symbol: '¥', digits: 0 },
  { code: 'KRW', name: '韓元', symbol: '₩', digits: 0 },
  { code: 'USD', name: '美元', symbol: 'US$', digits: 2 },
  { code: 'EUR', name: '歐元', symbol: '€', digits: 2 },
  { code: 'GBP', name: '英鎊', symbol: '£', digits: 2 },
  { code: 'HKD', name: '港幣', symbol: 'HK$', digits: 2 },
  { code: 'MOP', name: '澳門幣', symbol: 'MOP$', digits: 2 },
  { code: 'CNY', name: '人民幣', symbol: 'CN¥', digits: 2 },
  { code: 'SGD', name: '新加坡幣', symbol: 'S$', digits: 2 },
  { code: 'MYR', name: '馬來西亞令吉', symbol: 'RM', digits: 2 },
  { code: 'THB', name: '泰銖', symbol: '฿', digits: 2 },
  { code: 'VND', name: '越南盾', symbol: '₫', digits: 0 },
  { code: 'PHP', name: '菲律賓披索', symbol: '₱', digits: 2 },
  { code: 'IDR', name: '印尼盾', symbol: 'Rp', digits: 0 },
  { code: 'AUD', name: '澳幣', symbol: 'A$', digits: 2 },
  { code: 'NZD', name: '紐西蘭幣', symbol: 'NZ$', digits: 2 },
  { code: 'CAD', name: '加拿大幣', symbol: 'C$', digits: 2 },
  { code: 'CHF', name: '瑞士法郎', symbol: 'CHF', digits: 2 },
]

export function currencyInfo(code: string): CurrencyInfo {
  return CURRENCIES.find((c) => c.code === code) ?? { code, name: code, symbol: code + ' ', digits: 2 }
}

/** 國碼 → 當地幣別（人在國外時自動建議） */
const COUNTRY_CURRENCY: Record<string, string> = {
  tw: 'TWD', jp: 'JPY', kr: 'KRW', us: 'USD', gb: 'GBP', hk: 'HKD', mo: 'MOP', cn: 'CNY',
  sg: 'SGD', my: 'MYR', th: 'THB', vn: 'VND', ph: 'PHP', id: 'IDR', au: 'AUD', nz: 'NZD',
  ca: 'CAD', ch: 'CHF',
  // 歐元區
  at: 'EUR', be: 'EUR', hr: 'EUR', cy: 'EUR', ee: 'EUR', fi: 'EUR', fr: 'EUR', de: 'EUR',
  gr: 'EUR', ie: 'EUR', it: 'EUR', lv: 'EUR', lt: 'EUR', lu: 'EUR', mt: 'EUR', nl: 'EUR',
  pt: 'EUR', sk: 'EUR', si: 'EUR', es: 'EUR',
}

export function currencyForCountry(countryCode: string | undefined): string | null {
  if (!countryCode) return null
  return COUNTRY_CURRENCY[countryCode.toLowerCase()] ?? null
}

export const COUNTRY_NAME: Record<string, string> = {
  tw: '台灣', jp: '日本', kr: '韓國', us: '美國', gb: '英國', hk: '香港', mo: '澳門', cn: '中國',
  sg: '新加坡', my: '馬來西亞', th: '泰國', vn: '越南', ph: '菲律賓', id: '印尼', au: '澳洲',
  nz: '紐西蘭', ca: '加拿大', ch: '瑞士', fr: '法國', de: '德國', it: '義大利', es: '西班牙',
  nl: '荷蘭', at: '奧地利', pt: '葡萄牙', gr: '希臘', fi: '芬蘭', be: '比利時', ie: '愛爾蘭',
}

/** 依小數位數格式化數字（不含符號） */
export function formatNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(digits, Number.isInteger(n) ? 0 : 2),
  }).format(n)
}

export function formatCurrency(n: number, code: string): string {
  const info = currencyInfo(code)
  return `${info.symbol}${formatNumber(n, info.digits)}`
}

export function formatTwd(n: number): string {
  return formatCurrency(Math.round(n), 'TWD')
}

/** 原幣金額 × 匯率 → 新台幣，四捨五入到元 */
export function toTwd(amount: number, rate: number): number {
  return roundMoney(Math.round(amount * rate))
}

/**
 * 由「1 TWD = x 外幣」換算成「1 外幣 = 多少 TWD」，保留 4 位有效小數
 */
export function rateFromPerTwd(perTwd: Record<string, number>, code: string): number | null {
  if (code === 'TWD') return 1
  const x = perTwd[code]
  if (!x || !Number.isFinite(x) || x <= 0) return null
  const r = 1 / x
  return Number(r.toPrecision(4))
}
