import type { EntryKind } from './types'
import type { IconName } from '../components/Icon'

export interface Category {
  id: string
  name: string
  icon: IconName
  kind: 'expense' | 'income'
}

export const CATEGORIES: Category[] = [
  { id: 'food', name: '餐飲', icon: 'food', kind: 'expense' },
  { id: 'transport', name: '交通', icon: 'transport', kind: 'expense' },
  { id: 'shopping', name: '購物', icon: 'shopping', kind: 'expense' },
  { id: 'lodging', name: '住宿', icon: 'lodging', kind: 'expense' },
  { id: 'ticket', name: '門票', icon: 'ticket', kind: 'expense' },
  { id: 'daily', name: '日用', icon: 'daily', kind: 'expense' },
  { id: 'fun', name: '娛樂', icon: 'fun', kind: 'expense' },
  { id: 'bills', name: '帳單', icon: 'bills', kind: 'expense' },
  { id: 'medical', name: '醫療', icon: 'medical', kind: 'expense' },
  { id: 'other', name: '其他', icon: 'other', kind: 'expense' },
  { id: 'salary', name: '薪水', icon: 'salary', kind: 'income' },
  { id: 'bonus', name: '獎金', icon: 'bonus', kind: 'income' },
  { id: 'invest', name: '投資', icon: 'invest', kind: 'income' },
  { id: 'refund', name: '退款', icon: 'refund', kind: 'income' },
  { id: 'other-income', name: '其他', icon: 'other', kind: 'income' },
]

export function getCategory(id: string | null | undefined): Category | null {
  return CATEGORIES.find((c) => c.id === id) ?? null
}

export function categoriesFor(kind: EntryKind): Category[] {
  return kind === 'diary' ? [] : CATEGORIES.filter((c) => c.kind === kind)
}

export function defaultCategory(kind: EntryKind): string | null {
  if (kind === 'expense') return 'food'
  if (kind === 'income') return 'salary'
  return null
}

/** 由 OpenStreetMap 標籤猜分類 */
export function guessCategoryFromOsm(tags: Record<string, string>): string | null {
  const a = tags.amenity
  const s = tags.shop
  const t = tags.tourism
  if (a && /^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|biergarten)$/.test(a)) return 'food'
  if (s && /^(bakery|confectionery|pastry|tea|coffee|deli|beverages)$/.test(s)) return 'food'
  if (a && /^(fuel|parking|bicycle_rental|car_rental|taxi|ferry_terminal)$/.test(a)) return 'transport'
  if (tags.railway || tags.public_transport) return 'transport'
  if (t && /^(hotel|hostel|guest_house|motel|apartment)$/.test(t)) return 'lodging'
  if (t && /^(museum|attraction|zoo|theme_park|gallery|aquarium|viewpoint)$/.test(t)) return 'ticket'
  if (a && /^(place_of_worship)$/.test(a)) return 'ticket'
  if (a && /^(cinema|theatre|karaoke_box|arts_centre)$/.test(a)) return 'fun'
  if (a && /^(pharmacy|clinic|hospital|dentist|doctors)$/.test(a)) return 'medical'
  if (s && /^(convenience|supermarket|chemist|hardware|houseware)$/.test(s)) return 'daily'
  if (s) return 'shopping'
  return null
}
