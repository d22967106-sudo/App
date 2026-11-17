# 進度

最後更新：2026-11-17（第 2 階段程式完成，等使用者設定雲端帳號後實測）

## 目前狀態

**第 2 階段程式完成（2026-11-17），等使用者註冊 Supabase／Cloudflare 並照 `docs/setup-cloud.md` 設定後在 iPhone 實測。**

- 第 2 階段工作分支：`claude/start-phase-two-wqljng`（deploy.yml 已加入這個分支，使用者也已在 Settings → Environments → github-pages 開放這個分支；push 就會發布到 GitHub Pages，第 2 階段已上線）。
- 使用者要做的事：照 `docs/setup-cloud.md` 建 Supabase 專案、執行 `supabase/schema.sql`（已完成）、關閉 Confirm email、建 R2 bucket 與 Worker（`worker/photos.js`），然後在 App「統計 → 雲端同步」貼上網址與公開金鑰並登入。
- 待確認：Cloudflare 開通 R2 是否要求綁信用卡（網路資料說法不一）。如果要，而使用者不想綁，替代方案是 Supabase Storage（免費 1 GB），需要和使用者討論。

### 第 2 階段的做法

- **登入**：Supabase **電子郵件＋密碼**（建立帳號／登入兩個按鈕；Supabase 要關閉 Confirm email）。原本做的是信箱數字驗證碼，但 Supabase 從 2026 年 6 月起新的免費專案**不能改登入信範本**（要先設定自訂 SMTP），預設信裡只有連結，連結又會開到 Safari 而不是主畫面 App（儲存空間分開），所以改成密碼。不用 supabase-js，自己呼叫 REST（`src/lib/cloud.ts`），session 存在 IndexedDB meta（`cloud.session`），快過期自動 refresh，refresh 失敗就要求重新登入。
- **雲端設定**（Supabase 網址、公開金鑰、照片伺服器網址）在 App 裡輸入，存在 meta（`cloud.config`），沒有寫死在程式裡。
- **資料表**（`supabase/schema.sql`）：entries、summaries、track_points、places、photos 五張表格式相同：`user_id, id, updated_at(毫秒), deleted, data(jsonb＝App 的整筆資料), server_updated_at`；主鍵 (user_id, id)；RLS 只能讀寫自己的；trigger 設 server_updated_at，且「比較舊的 updated_at 不會蓋掉比較新的」。entries／track_points 另有由 data 產生的 `date` 欄位，給第 3 階段小工具查詢用。每日總結的 id＝日期。
- **同步**（`src/lib/sync.ts`）：
  - IndexedDB 升到第 2 版：新增 `outbox`（待上傳佇列，只記「哪張表哪一筆改過」）與 `displayCache`（大圖暫存）。升版時把第 1 階段的舊資料全部排進佇列。
  - 所有本地寫入（saveEntry、deleteEntry、saveSummary、track、putPlace、restoreAll）在同一個交易裡排進佇列。上傳時讀最新內容 upsert；本地已不存在就送 `deleted=true`。
  - 下載：每張表記住上次的 `server_updated_at`（meta `sync.cursor.<user>.<table>`），只拉之後改過的。本地還有沒上傳的修改就保留本地；雲端標成刪除就刪；否則雲端 updated_at 比較新才覆蓋。
  - 觸發時機：App 開啟、本地修改後 3 秒、回到前景、恢復網路、開著時每 5 分鐘；設定頁有「立即同步」。
- **照片**：上傳時先把縮圖、顯示版傳到 Worker，成功後才寫 photos 資料表，並把手機上的顯示版移到「大圖暫存」（不再永久佔空間）。其他裝置同步下來只有照片資料，縮圖會自動下載存在手機；大圖點開才下載並放暫存。暫存上限預設 200 MB（可選 100 MB～2 GB），超過刪最久沒看的；可手動清除。「暫停照片上傳」開關（iOS 偵測不到 Wi-Fi）。
- **備份匯出**仍是 ledger-diary-backup v1：縮圖＋手機上有的大圖（含暫存）；登入後可勾「包含雲端上的大圖」逐張下載放進 zip。照片資訊多了 `uploaded`，thumbFile 可能是 null。
- **測試**：`src/lib/sync.test.ts` 用假的 Supabase＋照片伺服器測 8 項（舊資料升級排隊、登入／建立帳號錯誤訊息、上傳＋另一台裝置下載、刪除同步、衝突處理、暫停照片上傳、token 換新／過期、暫存上限）。全部單元測試 67 項。設定頁用 Playwright 模擬 iPhone 13 走過設定→建立帳號→同步流程。

### 第 1 階段（已完成，使用者已在 iPhone 實測確認）

- 程式在分支 `claude/confident-babbage-8nlxkb`（React + TypeScript + Vite，Leaflet、idb、fflate、vite-plugin-pwa）。
- 注意：從 Safari 網址列開是網頁介面；「加入主畫面」後從圖示開才是全螢幕。
- 發布：`.github/workflows/deploy.yml` 會在 push 時 build 並發布到 GitHub Pages。
  已上線（repo 已公開、Pages Source 已設為 GitHub Actions）：https://d22967106-sudo.github.io/App/
- 下一步：使用者實測回饋 → 修正 → 進第 2 階段（雲端）。

### 實測回饋修正（第 1 輪）

- 地圖顏色不好看 → 新增 4 種地圖樣式（地圖右側「樣式」按鈕或「統計」分頁切換，選擇存在 IndexedDB，`src/lib/mapStyles.ts`）：
  - **奶茶淡色（預設）**：OpenFreeMap 向量地圖（positron），由 `src/lib/vectorStyle.ts` 依圖層種類重新上色成焦糖奶茶配色，地名中文優先
  - 清爽彩色：OpenFreeMap liberty，地名中文優先
  - OSM 原版、OSM 奶茶（點陣圖磚）
  - 向量地圖用 MapLibre GL（透過 @maplibre/maplibre-gl-leaflet 掛在 Leaflet 上，Leaflet 架構不變）；載入失敗時自動改用 OSM 奶茶。
  - 原本用的 CARTO 圖磚實測顯示「API key required」（現在要金鑰），已移除。
- 店名搜尋看起來不能用 → ① 店名欄可打字篩選附近店家，按放大鏡或鍵盤「搜尋」查 2 公里內的店名 ② 顯示查詢中／查不到／失敗可重試的狀態 ③ Overpass 三台伺服器輪流（overpass-api.de → overpass.kumi.systems → overpass.private.coffee），每台 9 秒逾時 ④ 附近範圍 150 → 200 公尺。
- 實測「搜尋失敗」（Overpass 用名字搜尋太慢／太忙）→ 打字搜尋改成依序：**Nominatim search**（限定附近 2 公里方框）→ **Photon**（photon.komoot.io）→ Overpass；逾時改用自己的 AbortController（不依賴 AbortSignal.any）。失敗時在狀態列用小字列出每個服務的失敗原因（例如「nominatim：HTTP 429」），方便截圖回報。
- 使用者決定**不需要自動列出附近店家** → 已移除（新增紀錄時不再自動查 Overpass）。保留「記住去過的店」（手機本地資料，附近 300 公尺內記過的店）與打字搜尋。plan.md 第 8 節已更新。
- 「時間要能調整」（常常事後補記）→ 新增紀錄頁的時間改成看得到的日期＋時間兩個欄位，加上「現在／1 小時前／3 小時前／昨天」快速按鈕；存檔後地圖跳到那一天。
- 「搜尋範圍 2 公里太小」（常常到家才記帳）→ 店名搜尋改成約 30 公里內、近的排前面，連鎖店的不同分店都會列出（Overpass 備案最多 8 公里，太大會逾時）。點選搜尋結果後，紀錄的地點改成那家店的位置並重新查地名（不會記成家裡）。
- 「地區＋店名」搜尋（`src/lib/areaQuery.ts`）：「嘉義幸福」→ 在嘉義市＋嘉義縣找「幸福」；「嘉義市東區幸福」→ 只找東區（查不到區就退回整個縣市）；「京都 抹茶」→ 空格隔開，前面可以是任何地名；開頭不是縣市就照舊搜附近 30 公里。地區範圍用 Nominatim 查 boundingbox（快取），再在範圍內依序用 Nominatim → Photon → Overpass 找店。誤判時可按「不是地區？整串當店名搜尋」。沒有定位時也能用地區搜尋。
- App 圖示換成使用者選定的設計：焦糖色底、手繪線條地球（亞洲／大洋洲這一面，自己畫的）、地球下方一個錢袋（形狀照使用者給的參考圖描出，面積＝地球的 10%，底部離地球下緣 14px）、左上鉛筆、右上大頭針插在地球上。原始檔 `public/favicon.svg`，PNG（180／192／512）由它產生。iPhone 主畫面要刪掉再重新「加入主畫面」才會換圖示（刪掉主畫面 App 可能連資料一起刪，要先匯出備份）。

### iPhone 實測回饋（第 2 輪）

- 實測結果：照片 4～5 張不會慢；加入主畫面、離線、匯出／匯入都正常。
- 找不到店（OSM 在台灣很多小店沒有資料，任何免費搜尋都找不到）→
  - **地點可以改**：新增紀錄頁「地點」區塊可「輸入地址」，用 Nominatim 查座標（門牌查不到就去掉門牌改找那條路，並提示「先定在那條路上」）；地點下方顯示地址。
  - **選搜尋到的店會自動帶入地址**（reverse geocode zoom 18，台灣地址格式「嘉義市東區中山路123號」）。
  - **從 Google 地圖／Apple 地圖「分享 → 複製」貼到店名欄**：自動拆出店名＋地址並定位（`src/lib/sharedPlace.ts`）。貼上時讀剪貼簿原文保留換行；換行被吃掉時從縣市名切開。只有短網址讀不到內容（瀏覽器不能跨網域讀 maps.app.goo.gl），會提示改用分享→複製或輸入地址。
- 金額輸入時自動加千分位逗號。
- 「打卡」改名「定位」（按鈕圖示改成定位準星）。

### iPhone 實測回饋（第 3 輪）

- 「定位不用記錄」→ 地圖首頁的「定位」按鈕改成只把地圖移到目前位置、顯示藍色圓點，不寫入 track（舊資料裡的定位點仍會顯示）。`addTrackPoint` 目前沒有地方呼叫，第 3 階段背景定位會用到。
- 「600嘉義市東區芳草里芳安路3號」找不到 → `parseTwAddress` 拆出縣市／區／路／門牌，去掉郵遞區號、村里、鄰；`geocodeAddress` 依序試：完整地址 → Nominatim 結構化查詢（路＋門牌、縣市）→ 路＋區＋縣市 → 路＋縣市 → Photon。門牌查不到時定在那條路上並提示。
- 在店名欄貼上「只有地址」的文字（有縣市＋門牌號）→ 直接拿去定位，不當店名。
- 「能手動拖動嗎」→ 新增紀錄頁「地點」多了「在地圖上調整」：全螢幕地圖、大頭針固定在中間，拖動地圖對準後按「確定位置」，再自動查地名與地址（`src/components/MapPicker.tsx`）。底圖邏輯抽成 `useBaseLayer`，跟首頁地圖共用樣式。注意：`useBaseLayer` 必須寫在「建立地圖」的 effect 之後（effect 依順序執行），否則地圖還沒建好、底圖加不上去（實測「拖動時看不到地圖」就是這個 bug，已修）。

### 程式結構

- `src/lib/`：資料與邏輯（`db.ts` IndexedDB、`types.ts` 資料模型、`currency.ts`／`rates.ts` 多幣別、`geocode.ts` 地名與附近店家、`places.ts` 記住去過的店、`photos.ts` 壓縮與 EXIF、`backup.ts` 匯出入、`day.ts` 路線與統計）
- 第 2 階段新增：`src/lib/cloud.ts`（雲端設定、登入、Supabase REST、照片伺服器）、`src/lib/sync.ts`（同步與大圖暫存）、`src/pages/CloudSection.tsx`（設定頁的雲端同步區塊）、`supabase/schema.sql`、`worker/photos.js`、`docs/setup-cloud.md`
- `src/pages/`：`MapPage` 地圖首頁、`EntryPage` 新增／編輯紀錄、`DayPage` 一天的完整回顧、`OtherPages` 日曆／旅程（預留）與統計與備份
- 測試：`npm test`（單元測試 39 項）；瀏覽器端對端測試用 Playwright 模擬 iPhone 13，所有外部服務都用假資料（腳本沒放進 repo）

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
- [x] 店名搜尋＋記住去過的店（自動列出附近店家已依使用者要求移除）
- [x] 多幣別與匯率
- [x] 照片選取與壓縮（暫存本地）
- [x] 一天的完整回顧（每日總結＋時間軸）
- [x] 定位按鈕（原「打卡」；使用者決定：不記錄，只把地圖移到目前位置並顯示圓點）
- [x] 本地資料庫（IndexedDB）
- [x] 匯出備份
- [x] 使用者在 iPhone 上實測（搜尋、照片、加入主畫面、離線、匯出匯入、地址與拖動調整位置都確認過）

## 第 2 階段：雲端

- [x] Supabase 資料表、RLS（`supabase/schema.sql`）、電子郵件驗證碼登入
- [x] 同步與離線佇列
- [x] R2 照片上傳（`worker/photos.js`，Worker＋R2 綁定）、縮圖／顯示版、大圖暫存
- [x] 設定教學 `docs/setup-cloud.md`
- [ ] 使用者註冊 Supabase／Cloudflare 並設定
- [ ] 使用者在 iPhone 上實測（登入、同步、照片上傳與大圖下載、離線後補傳）

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

- 第 2 階段只用假的 Supabase／Worker 測過，真實服務（寄信、RLS、R2）要等使用者設定後在 iPhone 上確認。
- 匯入舊備份會把資料排進上傳佇列；如果雲端有比較新的版本，伺服器會保留新的，但手機上會留著匯入的舊版本（單一裝置使用時不會發生）。
- 「下載這趟旅程的照片離線看」要等第 4 階段做旅程時一起做。
- 照片在第 1 階段原本兩種尺寸都存在手機上，登入後上傳完會把大圖移到暫存，暫存超過上限就會刪掉（雲端還有）。

- 在這個開發環境連不到 OSM、Nominatim、Overpass、匯率 API，這些只用假資料測過，要在 iPhone 上確認真的能用。
- iOS Safari 的 canvas 可能無法輸出 WebP，會自動改用 JPEG（計畫中的 WASM 編碼器還沒做，看實測檔案大小再決定）。
- Nominatim／Photon／Overpass 是免費公共服務，有速率限制；查不到時店名可手動輸入。
- 圖磚暫存只會存「看過的區域」；「出國前預先下載旅遊地區」還沒做。
- 向量地圖的實際外觀（OpenFreeMap 真實資料）在開發環境看不到，只驗證過背景色與上色邏輯，要在 iPhone 上確認。
- MapLibre 讓 App 大了約 1 MB（第一次開啟下載，之後由 Service Worker 暫存）。
