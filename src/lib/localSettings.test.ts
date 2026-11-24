import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { getMeta, setMeta } from './db'
import { buildLocalSettings, restoreLocalSettings } from './localSettings'

describe('本機設定備份／還原', () => {
  it('匯出只有清單裡的設定，匯入後一模一樣', async () => {
    await setMeta('auto.key', { key: 'abc', createdAt: 1 })
    await setMeta('route.legEdits', { '2026-11-21/leg-1': [[25, 121]] })
    await setMeta('mapStyle', 'tea')
    await setMeta('rates', { USD: 32 }) // 不在清單裡（匯率會自己重抓）
    const file = await buildLocalSettings()
    expect(Object.keys(file.meta).sort()).toEqual(['auto.key', 'mapStyle', 'route.legEdits'])
    // 模擬重新加入主畫面：資料被清掉
    await setMeta('auto.key', null)
    await setMeta('route.legEdits', null)
    await setMeta('mapStyle', null)
    const n = await restoreLocalSettings(JSON.stringify(file))
    expect(n).toBe(3)
    expect(await getMeta('auto.key')).toEqual({ key: 'abc', createdAt: 1 })
    expect(await getMeta('route.legEdits')).toEqual({ '2026-11-21/leg-1': [[25, 121]] })
  })

  it('不是本機設定檔就拒絕，也不會寫入清單以外的 key', async () => {
    await expect(restoreLocalSettings('not json')).rejects.toThrow()
    await expect(restoreLocalSettings(JSON.stringify({ format: 'other', meta: {} }))).rejects.toThrow()
    const n = await restoreLocalSettings(JSON.stringify({ format: 'koukou-local-settings', version: 1, meta: { evil: 1, mapStyle: 'osm' } }))
    expect(n).toBe(1)
    expect(await getMeta('evil')).toBeUndefined()
  })
})
