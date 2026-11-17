import { getRateCache, setMeta } from './db'
import { rateFromPerTwd } from './currency'
import { toDateKey } from './ledger'
import type { RateCache } from './types'

/** 兩個免費、免金鑰、含 TWD 的匯率來源，第一個失敗就用第二個 */
async function fetchPerTwd(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/TWD')
    if (res.ok) {
      const j = (await res.json()) as { result?: string; rates?: Record<string, number> }
      if (j.result === 'success' && j.rates) return j.rates
    }
  } catch {
    /* 換下一個來源 */
  }
  try {
    const res = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/twd.json')
    if (res.ok) {
      const j = (await res.json()) as { twd?: Record<string, number> }
      if (j.twd) {
        return Object.fromEntries(Object.entries(j.twd).map(([k, v]) => [k.toUpperCase(), v]))
      }
    }
  } catch {
    /* 都失敗 */
  }
  return null
}

let inflight: Promise<RateCache | null> | null = null

/** 取得匯率表：一天抓一次，抓不到就用上次的 */
export async function loadRates(force = false): Promise<RateCache | null> {
  const cached = await getRateCache()
  const today = toDateKey(new Date())
  if (!force && cached?.date === today) return cached
  inflight ??= (async () => {
    const perTwd = await fetchPerTwd()
    if (!perTwd) return cached ?? null
    const fresh: RateCache = { date: today, perTwd, fetchedAt: Date.now() }
    await setMeta('rates', fresh)
    return fresh
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** 1 外幣 = 多少 TWD；沒有資料回傳 null */
export async function getRate(code: string): Promise<{ rate: number; date: string } | null> {
  if (code === 'TWD') return { rate: 1, date: toDateKey(new Date()) }
  const cache = await loadRates()
  if (!cache) return null
  const rate = rateFromPerTwd(cache.perTwd, code)
  return rate ? { rate, date: cache.date } : null
}
