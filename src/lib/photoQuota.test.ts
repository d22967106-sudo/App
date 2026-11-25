import { describe, expect, it } from 'vitest'
import { HIGH_AT, needsCheck, quotaLevel, quotaMessage, shouldNotify, WARN_AT } from './photoQuota'
import { PHOTO_LIMIT } from './usage'

const GB = 1024 ** 3
const DAY = 86400000

describe('照片空間提醒', () => {
  it('依用量分級', () => {
    expect(quotaLevel(2 * GB)).toBe('ok')
    expect(quotaLevel(WARN_AT - 1)).toBe('ok')
    expect(quotaLevel(WARN_AT)).toBe('warn')
    expect(quotaLevel(HIGH_AT)).toBe('high')
    expect(quotaLevel(PHOTO_LIMIT)).toBe('high')
    expect(quotaLevel(PHOTO_LIMIT + 1)).toBe('over')
  })

  it('提醒文字', () => {
    expect(quotaMessage(1 * GB)).toBeNull()
    expect(quotaMessage(8.2 * GB)).toContain('快用完了')
    expect(quotaMessage(9.6 * GB)).toContain('超過會開始收費')
    expect(quotaMessage(11 * GB)).toContain('開始收費')
  })

  it('一天只查一次', () => {
    const now = 1_000 * DAY
    expect(needsCheck(undefined, now)).toBe(true)
    expect(needsCheck({ bytes: 0, objects: 0, checkedAt: now - DAY / 2 }, now)).toBe(false)
    expect(needsCheck({ bytes: 0, objects: 0, checkedAt: now - DAY }, now)).toBe(true)
  })

  it('通知一天最多一次，沒快滿不通知', () => {
    const now = 1_000 * DAY
    expect(shouldNotify(1 * GB, undefined, now)).toBe(false)
    expect(shouldNotify(9 * GB, undefined, now)).toBe(true)
    expect(shouldNotify(9 * GB, now - DAY / 3, now)).toBe(false)
    expect(shouldNotify(9 * GB, now - DAY, now)).toBe(true)
  })
})
