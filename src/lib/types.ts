export type TransactionType = 'expense' | 'income'

export interface Category {
  id: string
  name: string
  icon: string
  type: TransactionType
}

export interface Transaction {
  id: string
  type: TransactionType
  /** 正數金額，單位為元 */
  amount: number
  categoryId: string
  /** YYYY-MM-DD（當地日期） */
  date: string
  note: string
  createdAt: number
}

export type TransactionInput = Omit<Transaction, 'id' | 'createdAt'>
