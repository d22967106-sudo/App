import { useEffect } from 'react'
import { TabBar, ToastHost } from './components/ui'
import { requestPersistentStorage } from './lib/db'
import { useRoute } from './lib/hooks'
import { loadRates } from './lib/rates'
import { installAutomationHooks } from './lib/automation'
import { startAutoSync } from './lib/sync'
import { DayPage } from './pages/DayPage'
import { EntryPage } from './pages/EntryPage'
import { MapPage } from './pages/MapPage'
import { CalendarPage } from './pages/CalendarPage'
import { SettingsPage } from './pages/SettingsPage'
import { StatsPage } from './pages/StatsPage'
import { TripPage } from './pages/TripPages'
import { UsagePage } from './pages/UsagePage'

export default function App() {
  const { path, query } = useRoute()
  const top = path[0] || 'map'

  useEffect(() => {
    requestPersistentStorage()
    loadRates().catch(() => {})
    installAutomationHooks()
    startAutoSync()
  }, [])

  let page
  let withTabs = true
  if (top === 'entry') {
    withTabs = false
    page = <EntryPage key={path[1] ?? 'new'} id={path[1] && path[1] !== 'new' ? path[1] : null} date={query.get('d')} />
  } else if (top === 'day' && path[1]) {
    withTabs = false
    page = <DayPage date={path[1]} />
  } else if (top === 'usage') {
    withTabs = false
    page = <UsagePage />
  } else if (top === 'settings') {
    withTabs = false
    page = <SettingsPage />
  } else if (top === 'calendar') page = <CalendarPage month={query.get('m')} selected={query.get('d')} />
  else if (top === 'trip') {
    const tripView = <TripPage path={path.slice(1)} query={query} />
    withTabs = path.length < 2
    page = tripView
  } else if (top === 'stats') page = <StatsPage period={query.get('p')} />
  else page = <MapPage date={query.get('d')} />

  return (
    <>
      {page}
      {withTabs && <TabBar />}
      <ToastHost />
    </>
  )
}
