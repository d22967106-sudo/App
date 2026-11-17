import type { Category, TransactionType } from './types'

export const CATEGORIES: Category[] = [
  { id: 'food', name: '餐飲', icon: '🍱', type: 'expense' },
  { id: 'transport', name: '交通', icon: '🚌', type: 'expense' },
  { id: 'shopping', name: '購物', icon: '🛍️', type: 'expense' },
  { id: 'home', name: '居家', icon: '🏠', type: 'expense' },
  { id: 'bills', name: '帳單', icon: '🧾', type: 'expense' },
  { id: 'fun', name: '娛樂', icon: '🎮', type: 'expense' },
  { id: 'health', name: '醫療', icon: '💊', type: 'expense' },
  { id: 'education', name: '教育', icon: '📚', type: 'expense' },
  { id: 'other-expense', name: '其他', icon: '📦', type: 'expense' },
  { id: 'salary', name: '薪水', icon: '💼', type: 'income' },
  { id: 'bonus', name: '獎金', icon: '🎁', type: 'income' },
  { id: 'investment', name: '投資', icon: '📈', type: 'income' },
  { id: 'other-income', name: '其他', icon: '💰', type: 'income' },
]

const UNKNOWN: Category = { id: 'unknown', name: '未分類', icon: '❔', type: 'expense' }

export function getCategory(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? UNKNOWN
}

export function categoriesOf(type: TransactionType): Category[] {
  return CATEGORIES.filter((c) => c.type === type)
}
