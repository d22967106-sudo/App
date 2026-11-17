/** 紀錄類型：支出、收入、只寫日記 */
export type EntryKind = 'expense' | 'income' | 'diary'

export interface GeoPoint {
  lat: number
  lng: number
  /** 定位精確度（公尺） */
  accuracy?: number
}

export interface EntryLocation extends GeoPoint {
  /** 地區名稱，例如「祇園 · 京都」 */
  name?: string
  /** ISO 3166-1 alpha-2 小寫國碼，例如 tw、jp */
  countryCode?: string
}

/**
 * 一筆紀錄＝金額（可空）＋日記（可空）＋地點（自動）＋照片（可多張）
 */
export interface Entry {
  id: string
  kind: EntryKind
  /** 標題／店名，例如「拉麵」「捷運站旁咖啡」 */
  title: string
  /** 原幣金額（只寫日記時為 null） */
  amount: number | null
  /** 幣別代碼，例如 TWD、JPY */
  currency: string
  /** 匯率：1 單位原幣 = 多少新台幣 */
  rate: number
  /** 換算新台幣後的金額（只寫日記時為 null） */
  amountTwd: number | null
  categoryId: string | null
  /** 日記內容 */
  note: string
  /** 發生時間（epoch ms） */
  time: number
  /** 當地日期 YYYY-MM-DD，依 time 計算，方便查詢 */
  date: string
  location: EntryLocation | null
  photoIds: string[]
  /** 記住去過的店：對應 Place.id */
  placeId: string | null
  createdAt: number
  updatedAt: number
}

/** 每日總結：不屬於任何時間點，固定顯示在當天最上面 */
export interface DailySummary {
  date: string
  text: string
  mood: MoodId | null
  updatedAt: number
}

export type MoodId = 'great' | 'good' | 'okay' | 'tired' | 'sad'

/** 軌跡點：第 1 階段只有手動打卡；之後背景定位也寫在這裡 */
export interface TrackPoint {
  id: string
  time: number
  date: string
  lat: number
  lng: number
  accuracy?: number
  source: 'checkin' | 'auto'
  /** 地名，例如「抵達 公司」的「公司」 */
  label?: string
}

export interface Photo {
  id: string
  entryId: string
  /** 長邊 400px 縮圖 */
  thumb: Blob
  /** 長邊 2048px 顯示版（第 2 階段上傳後會刪除本地副本） */
  display: Blob | null
  width: number
  height: number
  /** 原始照片拍攝時間（方便回相簿找原圖） */
  takenAt: number | null
  createdAt: number
}

/** 記住去過的店 */
export interface Place {
  id: string
  name: string
  lat: number
  lng: number
  categoryId: string | null
  /** 最近幾次的原幣金額（新的在後） */
  recentAmounts: number[]
  currency: string
  visits: number
  lastVisit: number
}

export interface RateCache {
  /** 抓取日期 YYYY-MM-DD */
  date: string
  /** 1 TWD = x 單位外幣 */
  perTwd: Record<string, number>
  fetchedAt: number
}
