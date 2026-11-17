import { useEffect } from 'react'
import { TabBar, ToastHost } from './components/ui'
import { requestPersistentStorage } from './lib/db'
import { useRoute } from './lib/hooks'
import { loadRates } from './lib/rates'
import { DayPage } from './pages/DayPage'
import { EntryPage } from './pages/EntryPage'
import { MapPage } from './pages/MapPage'
import { CalendarPage, StatsPage, TripPage } from './pages/OtherPages'

export default function App() {
  const { path, query } = useRoute()
  const top = path[0] || 'map'

  useEffect(() => {
    requestPersistentStorage()
    loadRates().catch(() => {})
  }, [])

  let page
  let withTabs = true
  if (top === 'entry') {
    withTabs = false
    page = <EntryPage key={path[1] ?? 'new'} id={path[1] && path[1] !== 'new' ? path[1] : null} date={query.get('d')} />
  } else if (top === 'day' && path[1]) {
    withTabs = false
    page = <DayPage date={path[1]} />
  } else if (top === 'calendar') page = <CalendarPage />
  else if (top === 'trip') page = <TripPage />
  else if (top === 'stats') page = <StatsPage />
  else page = <MapPage date={query.get('d')} />

  return (
    <>
      {page}
      {withTabs && <TabBar />}
      <ToastHost />
    </>
  )
}
