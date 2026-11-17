import type { IconName } from '../components/Icon'
import type { MoodId } from './types'

export const MOODS: { id: MoodId; label: string; icon: IconName }[] = [
  { id: 'great', label: '超開心', icon: 'moodGreat' },
  { id: 'good', label: '心情不錯', icon: 'moodGood' },
  { id: 'okay', label: '普通', icon: 'moodOkay' },
  { id: 'tired', label: '有點累', icon: 'moodTired' },
  { id: 'sad', label: '不太好', icon: 'moodSad' },
]

export function getMood(id: MoodId | null | undefined) {
  return MOODS.find((m) => m.id === id) ?? null
}
