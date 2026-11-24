import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { getMeta } from './db'
import { setEntryEdit } from './entryRoute'
import { historyState, redoRoute, routeStep, undoRoute } from './routeHistory'
import { setLegEdit, updateLegCuts } from './snap'

describe('路線操作的上一步／下一步', () => {
  it('一個操作改好幾個設定算一步，可以上一步、下一步', async () => {
    await routeStep(() => setEntryEdit('2026-11-24', 'e1', [{ lat: 25, lng: 121 }]))
    await routeStep(async () => {
      await setLegEdit('2026-11-24', 'leg-1', [{ lat: 25.1, lng: 121 }])
      await updateLegCuts('2026-11-24', [1000])
    })
    expect(historyState()).toEqual({ canUndo: true, canRedo: false })
    await undoRoute()
    expect((await getMeta('route.legEdits')) ?? {}).toEqual({})
    expect((await getMeta('route.legCuts')) ?? {}).toEqual({})
    expect(await getMeta('route.entryEdits')).toEqual({ '2026-11-24/e1': [[25, 121]] })
    await undoRoute()
    expect((await getMeta('route.entryEdits')) ?? {}).toEqual({})
    expect(historyState()).toEqual({ canUndo: false, canRedo: true })
    await redoRoute()
    await redoRoute()
    expect(await getMeta('route.legCuts')).toEqual({ '2026-11-24': [1000] })
    // 做新的操作後，下一步清掉
    await undoRoute()
    await routeStep(() => setEntryEdit('2026-11-24', 'e2', [{ lat: 25, lng: 121 }]))
    expect(historyState().canRedo).toBe(false)
  })
})
