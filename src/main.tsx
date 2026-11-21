import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 主畫面上的 App 很少自己檢查新版（要關掉重開兩次才換得過來）：
// 每次回到 App 都檢查一次，有新版裝好接手就重新載入（正在新增／編輯紀錄時不重載，下次再換）
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || location.hash.startsWith('#/entry')) return
    reloading = true
    location.reload()
  })
  const check = () => {
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.update())
      .catch(() => {})
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  setInterval(check, 30 * 60 * 1000)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
