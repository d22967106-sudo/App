import { describe, expect, it } from 'vitest'
import {
  expenseByCategory,
  formatDayHeader,
  groupByDay,
  inMonth,
  parseAmount,
  shiftMonth,
  summarize,
} from './ledger'
import { parseTransactions } from './storage'
import type { Transaction } from './types'

let seq = 0
function tx(p: Partial<Transaction>): Transaction {
  seq++
  return {
    id: `t${seq}`,
    type: 'expense',
    amount: 100,
    categoryId: 'food',
    date: '2026-11-01',
    note: '',
    createdAt: seq,
    ...p,
  }
}

describe('summarize', () => {
  it('加總收入、支出與結餘，且無浮點誤差', () => {
    const s = summarize([
      tx({ amount: 0.1 }),
      tx({ amount: 0.2 }),
      tx({ type: 'income', amount: 1000 }),
    ])
    expect(s).toEqual({ income: 1000, expense: 0.3, balance: 999.7 })
  })

  it('空清單為 0', () => {
    expect(summarize([])).toEqual({ income: 0, expense: 0, balance: 0 })
  })
})

describe('inMonth / shiftMonth', () => {
  it('只取指定月份', () => {
    const list = [tx({ date: '2026-11-30' }), tx({ date: '2026-12-01' }), tx({ date: '2026-01-11' })]
    expect(inMonth(list, '2026-11').map((t) => t.date)).toEqual(['2026-11-30'])
  })

  it('跨年切換月份', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})

describe('groupByDay', () => {
  it('日期新到舊、同日依建立時間新到舊', () => {
    const a = tx({ date: '2026-11-01' })
    const b = tx({ date: '2026-11-03' })
    const c = tx({ date: '2026-11-01' })
    const groups = groupByDay([a, b, c])
    expect(groups.map((g) => g.date)).toEqual(['2026-11-03', '2026-11-01'])
    expect(groups[1].items.map((t) => t.id)).toEqual([c.id, a.id])
  })
})

describe('expenseByCategory', () => {
  it('只計支出並依金額排序、比例正確', () => {
    const r = expenseByCategory([
      tx({ categoryId: 'food', amount: 100 }),
      tx({ categoryId: 'transport', amount: 300 }),
      tx({ type: 'income', categoryId: 'salary', amount: 5000 }),
    ])
    expect(r).toEqual([
      { categoryId: 'transport', total: 300, ratio: 0.75 },
      { categoryId: 'food', total: 100, ratio: 0.25 },
    ])
  })
})

describe('parseAmount', () => {
  it.each([
    ['120', 120],
    ['1,200', 1200],
    [' 99.5 ', 99.5],
    ['0', null],
    ['-5', null],
    ['1.234', null],
    ['abc', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })
})

describe('formatDayHeader', () => {
  it('標示今天與昨天，含跨月', () => {
    expect(formatDayHeader('2026-11-17', '2026-11-17')).toBe('今天 · 11/17（二）')
    expect(formatDayHeader('2026-10-31', '2026-11-01')).toBe('昨天 · 10/31（六）')
    expect(formatDayHeader('2026-11-10', '2026-11-17')).toBe('11/10（二）')
  })
})

describe('parseTransactions', () => {
  it('壞資料回傳空陣列並濾掉不合法項目', () => {
    expect(parseTransactions('not json')).toEqual([])
    expect(parseTransactions('{"a":1}')).toEqual([])
    const good = tx({})
    expect(parseTransactions(JSON.stringify([good, { id: 1 }]))).toEqual([good])
  })
})
