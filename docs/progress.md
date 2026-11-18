# 進度

最後更新：2026-11-18（第 3 階段程式完成，等使用者在 iPhone 設定與實測）

## ⚠️ 給接手者的教訓（使用者特別交代，務必銘記）

第 2 階段花了很久，**主要原因是引導使用者設定外部服務時，給了很多過時的資訊**，讓使用者一直卡關：
- 叫使用者改 Supabase 登入信範本 → 新的免費專案從 2026 年 6 月起不能改（要先設自訂 SMTP），只好改成密碼登入。
- 教學寫「打開這個網址複製內容」→ 使用者把網址本身貼進 SQL Editor。
- 叫使用者在 iPhone 上貼程式碼到 Cloudflare 編輯器 → 手機上貼不了；改成從 GitHub 部署，又遇到介面上找不到 branch／root directory、Worker 名稱猜錯、Root directory 和 `-c` 路徑重複、在 Cloudflare 後台加的變數沒生效等問題，來回好幾輪。
- iOS Safari 的 IndexedDB Blob 限制沒事先考慮到，實機同步才出錯。

**接手時請做到：**
1. 叫使用者操作任何第三方後台（Supabase、Cloudflare、Apple 捷徑、Scriptable、Overland／OwnTracks…）之前，**先上網查最新的官方文件與限制**，不要憑記憶寫步驟；不確定的地方直接說不確定。
2. 使用者**只用 iPhone**（沒有電腦）：避免「在網頁編輯器貼程式碼」「複製長網址內容」這類手機上難做的步驟；能用設定檔、GitHub 自動部署、或直接把要貼的內容放在對話裡給他複製，就那樣做。
3. 能由程式／設定檔處理的（例如 Worker 變數寫進 `wrangler.toml`），就不要叫使用者去後台手動設定。
4. 一次只給一小段步驟，並說明「成功時會看到什麼」，讓使用者能自己判斷有沒有做對。

## 目前狀態

**第 3 階段（自動化）程式已完成（2026-11-18），工作分支 `claude/funny-carson-raa0uu`，經使用者同意已 fast-forward 合併到預設分支 `claude/confident-babbage-8nlxkb`（App 與照片伺服器都從預設分支自動部署）。下一步：使用者照 `docs/setup-automation.md` 一步一步設定並實測（A1、A2 已完成；B Overland 已設定：一鍵設定成功、Send Now 後 QUEUED 變 0。設定：Standard、100m、Min Distance 10m、Min Time 30s、送出間隔 5 分鐘、Show Background Location Indicator Yes。C1 快速記一筆已完成並測試成功（曾出現「網路連線中斷」，原因是標頭多了兩行空白，刪掉就好）；C2 步數已完成並測試成功；23:55 自動化已教；D Scriptable 預覽成功（等使用者放到主畫面、重新複製新版腳本）；C3 記下位置可選；隔天看 Overland 耗電，太耗再開 Pause Updates＋Resume with Geofence 200m）。**

### 第 3 階段的做法

- **認證**：背景定位 App、捷徑、小工具不能用帳號密碼，改用 App 產生的「自動化金鑰」（`ld_` 開頭、32 bytes 亂數）。Supabase 的 `api_keys` 只存 sha256 雜湊＋時區；金鑰本身存在手機 meta `auto.key`。每人一把，重新產生舊的就失效。
- **接收端**：掛在照片伺服器同一個 Worker（`worker/auto.js`，由 `photos.js` 轉給 `/auto/…`）。Worker 帶著金鑰用 publishable key 呼叫 Supabase 的 `auto_key_info`／`auto_write`／`auto_read`（`supabase/automation.sql`，security definer，只能碰固定幾張表）→ **不需要 service role key 或任何秘密**，Cloudflare 後台不用加設定。
  - `POST /auto/overland`（Bearer 金鑰，回 `{"result":"ok"}`，其他回應 Overland 會保留下次重送）、`POST /auto/owntracks`（Basic 密碼或 `?key=`，回 `[]`）、`POST /auto/location`、`POST /auto/entry`、`POST /auto/steps`、`GET /auto/widget?date=`、`GET /auto/photo/<id>`（小工具用縮圖）、`GET /auto/check`。
  - 軌跡點 id＝`auto-<毫秒>`，重送不會重複；步數只會變多（鎖定時讀到 0 不會蓋掉）。
  - 日期：Overland 的時間字串有時區就用它；其他用 `api_keys.tz`（App 每次同步後發現時區變了就更新）。手機同步下來時，`source:'auto'` 的軌跡點與 `source:'shortcut'` 的紀錄會用手機時區重算 `date`（`withLocalDate`）。
- **Overland 一鍵設定**：App 產生 `overland://setup?url=…&token=…&device_id=iphone`（Overland README 記載的設定網址）。
- **App 端**：
  - IndexedDB 升到第 3 版：新增 `steps`（每日步數，對應雲端 `daily_steps`）。雲端還沒建這張表時下載會跳過，不影響其他同步。備份 zip 多了 `steps`（舊備份沒有也能匯入）。
  - 時間軸與地圖（`src/lib/stays.ts`、`day.ts`）：背景定位的點不逐一列出，精確度 > 100 m 的點不用；路線去掉小於精確度（至少 25 m）的飄移；150 m 內待超過 10 分鐘＝停留 → 時間軸顯示灰字「抵達／離開 ○○」，地圖只標起點和停留。地點數＝停留＋手動定位＋有地點的紀錄。
  - 地圖首頁：有背景定位資料時，標出「最後位置」並在面板顯示「背景定位 HH:MM」（還沒停留滿 10 分鐘、也還沒移動時，至少看得出資料有進來；使用者 2026-11-18 第一次測試時畫面什麼都沒有，分不出有沒有收到）。
  - 停留的名稱（`stayNames.ts`）：附近的紀錄（記過的店名或地名）→ 記住去過的店 → 手機上的快取（meta `stay.names`）→ Nominatim。
  - 捷徑記的帳沒有地名，同步後自動補（每次最多 5 筆）。
  - 設定頁「自動化」區塊（`AutomationSection.tsx`）：複製設定 SQL、產生／重新產生金鑰、測試連線、一鍵設定 Overland、OwnTracks 網址、捷徑要貼的授權與網址、每月預算＋複製 Scriptable 腳本。
- **Scriptable**：範本 `scriptable/ledger-widget.js`，App 複製時填入網址、金鑰、預算、App 網址。中型（今日支出、本月預算進度、步數、最後地點、今天路線縮圖）、小型（今日支出＋預算；參數「一年前」→ 一年前的今天，有照片就當背景）、鎖定畫面長方形。沒網路時顯示上次的資料。
- **使用者回饋（2026-11-18）**：
  - 小工具：今天還沒離開起點 200 公尺時，右邊不畫路線，改顯示「今天在 ○○」（用 Scriptable 的 `Location.reverseGeocode` 查地名，查不到用最後一筆紀錄的地名）；沒有任何軌跡顯示「今天還沒有軌跡」。改了要使用者重新複製腳本貼上。
  - 點小工具打開主畫面的 App（不是 Safari）：捷徑「打開 URL」`webapp://d22967106-sudo.github.io/App/` 可以打開 App（Apple 沒有文件，網友回報、使用者實測；含 https:// 的寫法不行）。但 Scriptable 的 `widget.url` 和小工具設定的 Open URL 用 webapp:// 或 shortcuts:// 都會停在 Scriptable，所以腳本改成 `widget.url = URLScheme.forRunningScript() + '?open=1'`（Scriptable 自己的網址一定開得了），腳本收到 `open=1` 就 `Safari.open('shortcuts://run-shortcut?name=打開記帳日記')`，由捷徑（內容：打開 URL webapp://…）打開 App。使用者要建立同名捷徑。腳本版本 2026-11-18.6，使用者實測成功（Scriptable → 捷徑 → App）。也試過在 Scriptable 腳本裡直接 `Safari.open('webapp://…')`：沒反應，所以無法省掉捷徑那一跳；完全不經過 Scriptable 只有原生 App 小工具做得到（需要 Mac＋付費帳號，不在前提內）。
  - 設定頁「自動化」多了「檢查雲端收到的資料」：先同步，再顯示雲端最後收到的背景定位／步數（含伺服器收到時間）、手機上今天的背景定位點數與精確度範圍。用來遠端除錯（開發環境連不到 Supabase）。
  - 精確度門檻 100 → 200 公尺（Overland 設 Desired Accuracy 100m，室內可能超過 100）；地圖「最後位置」不看精確度。
  - 2026-11-19 00:43 使用者回報 23:55 步數自動化沒送到（雲端最後是 16:30 手動那筆）。查到手機鎖定時捷徑讀健康資料會失敗（Protected health data is inaccessible），所以改成：`/auto/steps` 的 `date` 可以填 `yesterday`；捷徑每次執行同時送今天和昨天；觸發改成「打開常用 App（LINE／Facebook）時」，那時一定解鎖。教學 C2 已改。
  - 同時回報背景定位雲端最後一點是 11/18 15:54；但 Overland 畫面顯示 00:49 時 QUEUED 0、LAST SENT 3 分鐘前、最後位置在約 2 km 外 → Overland 有送、伺服器回了 ok，但沒存進雲端（懷疑格式解析失敗被當成無效點，資料可能已遺失）。處理：Worker 把最近一次 Overland 請求摘要存在 R2 `<user>/_debug/overland.json`，`GET /auto/debug` 可讀，App「檢查雲端收到的資料」會顯示；時間格式多支援 epoch 數字與 Date.parse；整批都看不懂時回 422（Overland 會保留資料重送）。待使用者回報 debug 內容。
  - 金額沒填按儲存＝0 元（輸入框提示本來就是 0）。
  - Scriptable 腳本第一行有版本（`版本 2026-11-18.2`），App 設定頁顯示目前版本（`SCRIPT_VERSION` 從範本讀出），改腳本時要改版本號，使用者才知道要重新貼上。
  - 0 元也能記帳：App 的金額可以填 0（`parseAmount` 允許 0，列表顯示「0」不加正負號）；捷徑金額填 0 記成 0 元的帳，留空才當日記。
- **與規劃不同的地方**（技術限制）：iOS 捷徑「特定時間」自動化沒有每小時，「每小時補一個點」改成可選的幾個固定時間；已記在 plan.md。
- **測試**：`worker/auto.test.js` 15 項（格式解析、金鑰、重送、步數只增不減、小工具資料）；`supabase/automation.sql` 在本機 PostgreSQL 16 模擬 Supabase 的 auth／角色跑過（金鑰驗證、anon 不能直接讀表、不能呼叫 auto_user、不支援的表會拒絕）；停留偵測 4 項、同步 2 項；全部單元測試 88 項。Playwright 模擬 iPhone 13 看過地圖、回顧頁、設定頁；Scriptable 腳本用假的 Scriptable API 跑過中型與「一年前」。
- **沒辦法在開發環境確認的**：Overland 目前的設定畫面（官方文件網站連不到，只看了 GitHub 上的 README）、捷徑動作的繁中名稱、Scriptable 實機外觀、健康資料在鎖定時能不能讀。

### 第 2 階段（已完成）

**第 2 階段完成（2026-11-17），使用者已在 iPhone 實測：同步、照片上傳到 R2、大圖從雲端下載、離線補傳、刪除同步都正常。下一步：第 3 階段「自動化」，開新的工作階段來做。**

- 大圖畫質：使用者曾覺得從雲端下載的大圖「像素變低」，查證後是設計如此（顯示版長邊 2048、JPEG 80%，例如 1179×2556 的截圖變 945×2048），使用者接受，不改。
- 第 2 階段工作分支：`claude/start-phase-two-wqljng`（deploy.yml 已加入這個分支，使用者也已在 Settings → Environments → github-pages 開放這個分支；push 就會發布到 GitHub Pages）。
- **GitHub repo 的預設分支是 `claude/confident-babbage-8nlxkb`**，目前內容和 `claude/start-phase-two-wqljng` 相同（經使用者同意 fast-forward 合併過）。照片伺服器由 Cloudflare 從預設分支的 `worker/` 自動部署，所以**改 `worker/` 時要同步推到預設分支**（推到工作分支以外的分支前要先問使用者）。
- **Cloudflare 的 Production branch 原本是 `claude/start-phase-two-wqljng`（不是預設分支），第 3 階段推到預設分支時沒有自動部署；2026-11-18 使用者已改成 `claude/confident-babbage-8nlxkb`。** 注意：Cloudflare 的「Retry build」會重新部署那筆紀錄當時的舊程式，不會抓最新的。
- 照片伺服器：Cloudflare Worker `ledger-photos`，網址 https://ledger-photos.d22967106.workers.dev（`/health` 顯示 ok 表示設定正確）。Cloudflare Build 設定：Root directory＝`worker`，Build command＝`echo ok`，Deploy command＝`npx wrangler deploy`。R2 bucket `ledger-photos`。
- Supabase 專案網址 https://ouyvyqcfesoguhkjebsj.supabase.co，publishable key 已寫在 `worker/wrangler.toml` 的 [vars]（公開值）；App 裡的雲端設定由使用者自己貼上。Confirm email 已關閉。
- Supabase 的 **Allow new users to sign up** 已關閉（使用者 2026-11-17 確認）。
- 開發環境連不到 workers.dev、github.io、supabase.co（代理擋掉），只能靠使用者回報或 GitHub Actions 的結果確認。
- 第 3 階段開始前要知道：背景定位 App（Overland／OwnTracks）要能把軌跡送進 Supabase 的 `track_points` 表（格式見下面「資料表」）；可能需要一個接收端（Supabase Edge Function 或在現有 Worker 加路由）把它們的格式轉成 `{id, updated_at, deleted, data}`。Scriptable 小工具可用 `entries` 的 `date` 欄位查當天資料。**動手前先查這些 App 目前的最新版本與設定方式**。

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

- [x] Supabase 資料表、RLS（`supabase/schema.sql`）、電子郵件＋密碼登入
- [x] 同步與離線佇列
- [x] R2 照片上傳（`worker/photos.js`，Worker＋R2 綁定）、縮圖／顯示版、大圖暫存
- [x] 設定教學 `docs/setup-cloud.md`
- [x] 使用者註冊 Supabase／Cloudflare 並設定（2026-11-17；照片已確認存到 R2）
- [x] 使用者在 iPhone 上實測（登入、同步、照片上傳與大圖下載、離線後補傳、刪除同步）

## 第 3 階段：自動化

- [x] 背景定位接收入口（Overland／OwnTracks）— `worker/auto.js`、`supabase/automation.sql`
- [x] 捷徑教學：快速記一筆、每晚步數、記下位置（`docs/setup-automation.md`）
- [x] Scriptable 小工具（`scriptable/ledger-widget.js`，App 設定頁複製）
- [x] 時間軸「抵達／離開」、步數顯示
- [x] 部署：已推到預設分支（App 由 GitHub Actions、照片伺服器由 Cloudflare 自動部署；照片伺服器是否部署成功要使用者按「測試連線」確認）
- [x] 使用者執行 automation.sql、產生金鑰、設定 Overland／捷徑（記一筆、記步數）／Scriptable（2026-11-18）
- [ ] 使用者在 iPhone 上實測一整天：出門的路線與「抵達／離開」、23:55 自動記步數、Overland 耗電、小工具「今天在／路線」切換
- [ ] （可選）C3 記下位置捷徑；App 名稱改「摳摳手帳」（使用者主畫面已改名，App 內文字要不要改還沒回覆）

## 第 4 階段：進階

- [ ] 旅程、旅遊軌跡圖
- [ ] 日曆、統計
- [ ] 軌跡精簡
- [ ] 掃電子發票
- [ ] 軌跡停留提醒
- [ ] 使用狀況頁

## 已知問題

- iOS Safari 不能把「從 IndexedDB 讀出來的 Blob」或「網路下載的 Blob」直接再存回 IndexedDB（Error preparing Blob/File data to be stored in object store）。已改成：再存之前用 `freshBlob()` 複製成新 Blob；大圖暫存改存 ArrayBuffer。之後新增寫入照片的程式都要注意這點。

- 匯入舊備份會把資料排進上傳佇列；如果雲端有比較新的版本，伺服器會保留新的，但手機上會留著匯入的舊版本（單一裝置使用時不會發生）。
- 「下載這趟旅程的照片離線看」要等第 4 階段做旅程時一起做。
- 照片在第 1 階段原本兩種尺寸都存在手機上，登入後上傳完會把大圖移到暫存，暫存超過上限就會刪掉（雲端還有）。

- 在這個開發環境連不到 OSM、Nominatim、Overpass、匯率 API，這些只用假資料測過，要在 iPhone 上確認真的能用。
- iOS Safari 的 canvas 可能無法輸出 WebP，會自動改用 JPEG（計畫中的 WASM 編碼器還沒做，看實測檔案大小再決定）。
- Nominatim／Photon／Overpass 是免費公共服務，有速率限制；查不到時店名可手動輸入。
- 圖磚暫存只會存「看過的區域」；「出國前預先下載旅遊地區」還沒做。
- 向量地圖的實際外觀（OpenFreeMap 真實資料）在開發環境看不到，只驗證過背景色與上色邏輯，要在 iPhone 上確認。
- MapLibre 讓 App 大了約 1 MB（第一次開啟下載，之後由 Service Worker 暫存）。
