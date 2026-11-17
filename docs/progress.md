# 進度

最後更新：2026-11-17（第 1 階段完成）

## 目前狀態

**第 1 階段程式已完成，等使用者在 iPhone 上實測。**

- 程式在分支 `claude/confident-babbage-8nlxkb`（React + TypeScript + Vite，Leaflet、idb、fflate、vite-plugin-pwa）。
- 注意：從 Safari 網址列開是網頁介面；「加入主畫面」後從圖示開才是全螢幕。
- 發布：`.github/workflows/deploy.yml` 會在 push 時 build 並發布到 GitHub Pages。
  已上線（repo 已公開、Pages Source 已設為 GitHub Actions）：https://d22967106-sudo.github.io/App/
- 下一步：使用者實測回饋 → 修正 → 進第 2 階段（雲端）。

### 實測回饋修正（第 1 輪）

- 地圖顏色不好看 → 新增 4 種地圖樣式（都是 OSM 資料、免費免金鑰）：奶茶淡色（CARTO Positron＋暖色濾鏡，**預設**）、清爽彩色（CARTO Voyager）、OSM 原版、OSM 奶茶。地圖右側「樣式」按鈕或「統計」分頁可切換，選擇存在 IndexedDB（`src/lib/mapStyles.ts`）。
- 店名搜尋看起來不能用 → ① 店名欄可打字篩選附近店家，按放大鏡或鍵盤「搜尋」查 2 公里內的店名 ② 顯示查詢中／查不到／失敗可重試的狀態 ③ Overpass 三台伺服器輪流（overpass-api.de → overpass.kumi.systems → overpass.private.coffee），每台 9 秒逾時 ④ 附近範圍 150 → 200 公尺。

### 程式結構

- `src/lib/`：資料與邏輯（`db.ts` IndexedDB、`types.ts` 資料模型、`currency.ts`／`rates.ts` 多幣別、`geocode.ts` 地名與附近店家、`places.ts` 記住去過的店、`photos.ts` 壓縮與 EXIF、`backup.ts` 匯出入、`day.ts` 路線與統計）
- `src/pages/`：`MapPage` 地圖首頁、`EntryPage` 新增／編輯紀錄、`DayPage` 一天的完整回顧、`OtherPages` 日曆／旅程（預留）與統計與備份
- 測試：`npm test`（單元測試 28 項）；瀏覽器端對端測試用 Playwright 模擬 iPhone 13，所有外部服務都用假資料（腳本沒放進 repo）

### 第 1 階段的做法與決定

- 路線＝當天「打卡點」＋「有地點的紀錄」依時間連直線；第 3 階段背景定位的軌跡點也寫進同一個 `track` 資料表。
- 地圖圖磚加上褐色濾鏡接近焦糖奶茶色；去過的圖磚由 Service Worker 暫存（最多 3000 張、60 天）。
- 匯率來源：open.er-api.com（主要）、jsDelivr 的 fawazahmed0 currency-api（備用），一天抓一次存在 IndexedDB；抓不到時可手動輸入。
- 照片：縮圖長邊 400px、顯示版長邊 2048px，優先 WebP，瀏覽器輸出不了就用 JPEG 80%（第 1 階段兩種都存在手機上）。
- 地點數：120 公尺內算同一個地點。記住去過的店：同名且 150 公尺內算同一家。
- 底部「統計」分頁暫時放本月合計＋資料備份（匯出／匯入 zip）。

## 討論與設計（已完成）

- [x] 功能與架構討論（見 `docs/plan.md`）
- [x] 介面預覽圖 6 張：https://claude.ai/artifact/MoLY5v8m1ALEKzBC1dL9Ff
- [x] 配色定案：B 焦糖奶茶，已套用到預覽圖
- [x] 「怎麼實現」資料流圖與功能表（在同一份預覽裡）
- [ ] 日曆頁、統計頁的預覽圖（尚未畫，可在第 4 階段前補）

## 第 1 階段：核心 App

- [x] 專案骨架（PWA manifest、Service Worker、GitHub Pages 發布）
- [x] 地圖首頁（Leaflet＋OSM、當天路線、標記、下方時間軸面板）
- [x] 日期切換
- [x] 新增紀錄（支出／收入／只寫日記、金額、分類、日記、時間）
- [x] 自動定位＋地名
- [x] 附近店家查詢＋記住去過的店
- [x] 多幣別與匯率
- [x] 照片選取與壓縮（暫存本地）
- [x] 一天的完整回顧（每日總結＋時間軸）
- [x] 手動打卡
- [x] 本地資料庫（IndexedDB）
- [x] 匯出備份
- [ ] 使用者在 iPhone 上實測

## 第 2 階段：雲端

- [ ] Supabase 專案、資料表、RLS、登入
- [ ] 同步與離線佇列
- [ ] R2 照片上傳（代簽程式）、縮圖／顯示版、大圖暫存

## 第 3 階段：自動化

- [ ] 背景定位接收入口（Overland／OwnTracks）
- [ ] 捷徑教學：快速記一筆、每晚步數、每小時定位
- [ ] Scriptable 小工具

## 第 4 階段：進階

- [ ] 旅程、旅遊軌跡圖
- [ ] 日曆、統計
- [ ] 軌跡精簡
- [ ] 掃電子發票
- [ ] 軌跡停留提醒
- [ ] 使用狀況頁

## 已知問題

- 在這個開發環境連不到 OSM、Nominatim、Overpass、匯率 API，這些只用假資料測過，要在 iPhone 上確認真的能用。
- iOS Safari 的 canvas 可能無法輸出 WebP，會自動改用 JPEG（計畫中的 WASM 編碼器還沒做，看實測檔案大小再決定）。
- Nominatim／Overpass 是免費公共服務，有速率限制；查不到時店名可手動輸入。
- 圖磚暫存只會存「看過的區域」；「出國前預先下載旅遊地區」還沒做。
- 金額欄輸入時不會自動加千分位逗號（顯示時有）。
