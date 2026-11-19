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
  /** 地址，例如「嘉義市東區中山路 123 號」 */
  address?: string
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
  /** 從捷徑「快速記一筆」送來的（地名之後由 App 補上） */
  source?: 'shortcut'
}

/** 每日總結：不屬於任何時間點，固定顯示在當天最上面 */
export interface DailySummary {
  date: string
  text: string
  mood: MoodId | null
  updatedAt: number
}

export type MoodId = 'great' | 'good' | 'okay' | 'tired' | 'sad'

/** 每日步數（捷徑每晚從健康 App 讀出來送到雲端） */
export interface DailySteps {
  date: string
  steps: number
  /** 步行＋跑步距離（公里） */
  distanceKm?: number
  updatedAt: number
}

/** 軌跡點：checkin＝舊版手動定位；auto＝背景定位 App（Overland／OwnTracks）或捷徑送來的 */
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

/** 旅程的一段日期（含頭尾） */
export interface TripSegment {
  start: string
  end: string
}

/** 旅程：一段或好幾段日期，每天一種顏色 */
export interface Trip {
  id: string
  name: string
  /** 最早、最晚的日期 YYYY-MM-DD（含頭尾；有 segments 時＝第一段的開始、最後一段的結束） */
  start: string
  end: string
  /** 好幾段不連續的日期（例如分三次環島）；沒有就是 start～end 一整段 */
  segments?: TripSegment[]
  /** 舊版：每天的小標題（第 i 個＝第 i+1 天）。新版改存在 titles */
  dayTitles: string[]
  /** 每天的小標題，key 是日期（日期增減時不會對錯天） */
  titles?: Record<string, string>
  /** 封面照片；沒選就用軌跡縮圖 */
  coverPhotoId: string | null
  createdAt: number
  updatedAt: number
}

export interface Photo {
  id: string
  entryId: string
  /** 長邊 400px 縮圖（手機和雲端各一份；從雲端同步下來、還沒下載完時為 null） */
  thumb: Blob | null
  /** 長邊 2048px 顯示版（上傳到雲端後刪除本地副本，改放有上限的暫存） */
  display: Blob | null
  /** 縮圖與顯示版都已上傳到雲端 */
  uploaded?: boolean
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
  /** 最後修改時間（同步用；舊資料沒有，就用 lastVisit） */
  updatedAt?: number
}

export interface RateCache {
  /** 抓取日期 YYYY-MM-DD */
  date: string
  /** 1 TWD = x 單位外幣 */
  perTwd: Record<string, number>
  fetchedAt: number
}
