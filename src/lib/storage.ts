import type { Transaction } from './types'

const KEY = 'ledger.transactions.v1'

function isTransaction(v: unknown): v is Transaction {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return (
    typeof t.id === 'string' &&
    (t.type === 'expense' || t.type === 'income') &&
    typeof t.amount === 'number' &&
    Number.isFinite(t.amount) &&
    typeof t.categoryId === 'string' &&
    typeof t.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
    typeof t.note === 'string' &&
    typeof t.createdAt === 'number'
  )
}

export function parseTransactions(raw: string | null): Transaction[] {
  if (!raw) return []
  try {
    const data: unknown = JSON.parse(raw)
    return Array.isArray(data) ? data.filter(isTransaction) : []
  } catch {
    return []
  }
}

export function loadTransactions(): Transaction[] {
  try {
    return parseTransactions(localStorage.getItem(KEY))
  } catch {
    return []
  }
}

/** 回傳是否成功寫入（隱私模式或空間不足時可能失敗） */
export function saveTransactions(list: Transaction[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}
