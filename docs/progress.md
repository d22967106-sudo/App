# 進度

最後更新：2026-11-19（第 4 階段程式完成，等使用者同意發布、在 iPhone 實測）

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

**2026-11-22 小工具美化（工作分支 `claude/nice-pasteur-6gt4nv`，腳本版本 2026-11-22.4，還沒合併到預設分支）：** 使用者一路調整：要美術設計 → 奶茶色系、文青風、**不要奶茶（珍珠杯）裝飾** → **復古紙張**（不要髒污、要逼真；參考圖：米灰舊紙、細顆粒、四周焦褐燒邊，**紋路要淡**）→ 地圖那側要**真實的放大鏡看地圖**（放大鏡外模糊；沒有地圖也要放一張地圖做同樣效果）→ **字體偏草書** → 右下角標示要融入主題。目前做法：
- **圖片素材**（`scriptable/make-widget-art.py`，numpy＋Pillow 程式生成，不用網路素材）→ `public/widget/`：`paper-medium.jpg`、`paper-small.jpg`（舊紙）、`magnifier.png`（跟地圖卡片一樣大 140×132 點的 3 倍，透明背景：環形斷面光影的銅框、木紋木柄、銅套、影子，鏡片處挖空）、`glass.png`（鏡片邊緣暗圈、內緣亮邊、左上弧形反光）。跟 App 一起發布到 GitHub Pages（png 會進 Service Worker 預先快取，共約 140 KB）。腳本 `loadArt` 從 `APP_URL + widget/…` 下載一次存在 Scriptable 的 documentsDirectory（檔名含 `ART_VER`，換圖時加 1）；紙下載不到用 DrawContext 畫的米灰底，放大鏡下載不到就只有地圖。**要先發布 App，小工具才下載得到圖**。
- 地圖卡片（`rightCard`）：底圖＝**模糊的地圖**（DrawContext 不能模糊，用「低 4 層的 OSM 圖磚放大 16 倍」，範圍是鏡片的 4 倍）＋舊地圖色調＋四周暗角＋放大鏡圖＋右下角撕邊舊紙片（`drawTag`，DrawContext 畫）；鏡片＝圓形 stack（`LENS` r 38，比挖空的洞大 1 點蓋住接縫），裡面是清楚的地圖（放大 1.25 倍）＋路線／圓點＋玻璃反光圖。沒有任何定位時鏡片看台灣（`DEFAULT_VIEW` z7），紙片寫「今天／還沒有足跡」。放大鏡位置（CARD、LENS）在 Python 和腳本裡要一致。
- 字：日期與金額用 iPhone 內建草寫體 `SnellRoundhand-Bold`（`script()`，只有英文與數字）；日期「Sunday, Nov 22」；「今日支出　今天記了 N 筆」合成一行；中文用系統字。**iPhone 沒有內建中文草書字體，Scriptable 也不能下載字體**，已跟使用者說明。
- 開發環境用 Playwright＋假的 Scriptable API（scratchpad）＋假圖磚＋相近的草寫字（Pinyon Script）看過；真的 OSM 模糊效果、Snell Roundhand 實際寬度、圓形 stack 跟放大鏡圖對不對得齊要在 iPhone 上確認。之前做過的版本（漸層膠囊、珍珠杯、文青米白＋拍立得、牛皮紙、金黃斑駁紙、DrawContext 畫的卡通放大鏡）都被使用者換掉，不要再提。
- **要經使用者同意合併到預設分支發布，使用者再到設定頁重新複製腳本貼到 Scriptable（腳本名稱、捷徑名稱沒動）。**

**2026-11-21～22 路線與耗電調整（工作分支 `claude/affectionate-maxwell-xwwddl`，每次都經使用者同意推到預設分支發布；最後版本 11/22 01:08）。使用者說「先這樣」暫停。細節見下方「路線改善」底下 2026-11-21 起的條目。待使用者實測：**
- 局部手繪修改路線（只畫錯的那一小段）、兩指縮放能不能用、修改後畫面不跳。
- 騎車停車後走路會切成兩段（停車處）。
- 迴轉不繞街區（Valhalla 已開 ignore_oneways／ignore_restrictions）。
- 小工具：今天還沒有點時顯示「今天在 ○○」（Worker 改了，腳本不用重貼）；小工具路線縮圖加地圖底圖（腳本 2026-11-21.2，使用者已貼上）。
- **還沒決定**：Overland Min Time 30s → 10s（使用者要「點多一點」，我建議 10s，等使用者改並觀察耗電）；耗電目標「一天 10% 以下」——電池頁的 14% 是占比不是整顆電池，換算約 9%，建議先把送出間隔 5 → 15 分鐘試，Auto-Stop 會漏短距離走路（使用者還沒回覆）。
- 地圖頁面板固定顯示「版本 MM/DD HH:MM」（建置時間），使用者用它確認有沒有更新。
- 已知：手繪修改只存在手機上不同步；面板公里數沒算短的走路段；停留地名只到「里」。

**第 4 階段（日曆、統計、旅程、軌跡圖、使用狀況）程式完成（2026-11-19），在工作分支 `claude/eloquent-faraday-9t5s59`，已合併到預設分支發布，等使用者到使用狀況頁執行 phase4.sql、在 iPhone 實測。細節見下方「第 4 階段」。**

**第 3 階段實測完成（2026-11-19）：背景定位存進雲端、地圖路線與「抵達／離開」、步數、小工具都正常；耗電可接受（見下方）。下一步：使用者決定是否進第 4 階段。**

第 3 階段（自動化）程式已完成（2026-11-18），工作分支 `claude/funny-carson-raa0uu`，經使用者同意已 fast-forward 合併到預設分支 `claude/confident-babbage-8nlxkb`（App 與照片伺服器都從預設分支自動部署）。下一步：使用者照 `docs/setup-automation.md` 一步一步設定並實測（A1、A2 已完成；B Overland 已設定：一鍵設定成功、Send Now 後 QUEUED 變 0。設定：Standard、100m、Min Distance 10m、Min Time 30s、送出間隔 5 分鐘、Show Background Location Indicator Yes。C1 快速記一筆已完成並測試成功（曾出現「網路連線中斷」，原因是標頭多了兩行空白，刪掉就好）；C2 步數已完成並測試成功；23:55 自動化已教；D Scriptable 預覽成功（等使用者放到主畫面、重新複製新版腳本）；C3 記下位置可選；隔天看 Overland 耗電，太耗再開 Pause Updates＋Resume with Geofence 200m）。**

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
  - 2026-11-19 00:43 使用者回報 23:55 步數自動化沒送到（雲端最後是 16:30 手動那筆）。查到手機鎖定時捷徑讀健康資料會失敗（Protected health data is inaccessible），所以改成：`/auto/steps` 的 `date` 可以填 `yesterday`；捷徑每次執行同時送今天和昨天；觸發改成「打開常用 App（LINE／Facebook）時」，那時一定解鎖。教學 C2 已改。使用者決定：捷徑只送「昨天」的步數（調整日期減 1 天 → 尋找健康樣本 開始日期 是 調整後的日期 → 總和 → JSON 加 date=yesterday），自動化改成「打開 Facebook 時」執行，23:55 那個刪掉。當天的步數要隔天才會出現。
  - 同時回報背景定位雲端最後一點是 11/18 15:54；但 Overland 畫面顯示 00:49 時 QUEUED 0、LAST SENT 3 分鐘前、最後位置在約 2 km 外 → Overland 有送、伺服器回了 ok，但沒存進雲端（懷疑格式解析失敗被當成無效點，資料可能已遺失）。處理：Worker 把最近一次 Overland 請求摘要存在 R2 `<user>/_debug/overland.json`，`GET /auto/debug` 可讀，App「檢查雲端收到的資料」會顯示；時間格式多支援 epoch 數字與 Date.parse；整批都看不懂時回 422（Overland 會保留資料重送）。待使用者回報 debug 內容（2026-11-19 01:xx 確認 Worker 已是新版；使用者明天移動後再測）。
  - 金額沒填按儲存＝0 元（輸入框提示本來就是 0）。
  - Scriptable 腳本第一行有版本（`版本 2026-11-18.2`），App 設定頁顯示目前版本（`SCRIPT_VERSION` 從範本讀出），改腳本時要改版本號，使用者才知道要重新貼上。
  - 0 元也能記帳：App 的金額可以填 0（`parseAmount` 允許 0，列表顯示「0」不加正負號）；捷徑金額填 0 記成 0 元的帳，留空才當日記。
- **實測結果（2026-11-19）**：
  - 背景定位：雲端有收到，路線與「抵達／離開」正常（11/18 沒存進去的問題已不再出現）。
  - 步數：使用者改成**按小工具時**順便送今天＋昨天的步數（小工具 → Scriptable → 捷徑「打開記帳日記」，使用者在這個捷徑裡加了記步數；那時一定解鎖），實測正常。
  - 小工具「今天在／路線」切換、點小工具打開 App 正常。
  - 耗電：到 21:56 全天用 53%（iOS 說與平常相似）；Overland 背景 21 時 18 分，占 7%（約全部電量的 4%）。使用者體感待機 12 小時約掉 30%。不需要開 Pause Updates／Geofence，維持現在的設定。
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
- `src/pages/`：`MapPage` 地圖首頁、`EntryPage` 新增／編輯紀錄、`DayPage` 一天的完整回顧、`CalendarPage` 日曆、`StatsPage` 統計、`TripPages` 旅程／軌跡圖、`SettingsPage` 設定與備份、`UsagePage` 使用狀況（第 4 階段）
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
- [x] 日曆頁、統計頁的預覽圖（2026-11-19 補上，第 5 列：7 日曆、8 統計、9 旅程列表、10 建立旅程、11 生成旅遊軌跡圖）

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
- [x] 使用者在 iPhone 上實測一整天：出門的路線與「抵達／離開」、步數（改成按小工具時送）、Overland 耗電、小工具「今天在／路線」切換（2026-11-19）
- [ ] （可選）C3 記下位置捷徑
- [x] App 名稱改「摳摳手帳」（2026-11-19）：標題、manifest、設定頁底部、備份檔名、小工具標題（腳本版本 2026-11-19.1，要重新貼上）。**捷徑名稱「打開記帳日記」與 Scriptable 腳本名稱當時沒改**（2026-11-21 使用者已把捷徑改成「打開摳摳手帳」，範本已跟著改）。程式碼註解、repo 名稱、備份格式 `ledger-diary-backup` 不變。在工作分支 `claude/eloquent-faraday-9t5s59`，要合併到預設分支才會發布。

## 第 4 階段：進階

使用者 2026-11-19 決定：做日曆、統計、旅程、旅遊軌跡圖、使用狀況頁（照示意圖第 5 列；設定搬到統計頁右上齒輪、旅程自動建議「離家超過 50 公里的連續幾天」都同意）。掃發票先不做；停留提醒不做；軌跡精簡不做（使用者一天約 71 個背景定位點，一年約 10～15 MB，500 MB 夠用 30 年以上，使用狀況頁會顯示實際用量）。

- [x] 日曆（`src/pages/CalendarPage.tsx`，`#/calendar?m=YYYY-MM&d=日期`）：每天支出、第一張照片小縮圖、日記小圓點、旅程橫條；點一天顯示摘要（支出、步數、地點、照片、日記開頭）→「打開這一天」到地圖。
- [x] 統計（`src/pages/StatsPage.tsx`，`#/stats?p=YYYY-MM` 或 `YYYY`）：月／年切換、支出收入結餘、跟上個月同期（本月）或整個上個月比、每日（年：每月）支出長條＋平均線（點長條跳到那天／那個月）、分類（點開看明細，最多 30 筆）、平均步數／移動距離／地點／照片。計算在 `src/lib/stats.ts`。
- [x] 設定搬到 `#/settings`（統計頁右上齒輪，原本的 `OtherPages.tsx` 改名 `SettingsPage.tsx`），多了「使用狀況」入口。
- [x] 旅程（`src/pages/TripPages.tsx`、`src/lib/trips.ts`）：
  - 資料：IndexedDB 升第 4 版新增 `trips`（`Trip`：name、start、end、dayTitles、coverPhotoId），同步到雲端 `trips` 表（`supabase/phase4.sql`）；雲端還沒建表時旅程留在手機（佇列不清掉），旅程頁會顯示「旅程還沒同步到雲端」→ 點了到使用狀況頁複製 SQL。備份 zip 多了 `trips`。
  - 列表 `#/trip`：封面（有選照片用照片，否則軌跡縮圖）、日期、花費、公里、照片數。
  - 自動建議：家＝最常過夜的地方（每天最早／最晚的位置，約 2 km 一格，至少 3 次）；某天任何一點離家 > 50 km 就算外地；連續 ≥ 2 天、已經回家（最後位置不在外地、結束日 < 今天）、沒跟現有旅程重疊、沒按過「不用」（meta `trip.dismissed`）才建議；名稱取紀錄地名裡最常出現的縣市（去掉市／縣）。
  - 建立／編輯 `#/trip/new?s=&e=&n=`、`#/trip/<id>/edit`：名稱、日期（最多 60 天）、每天小標題、封面照片、刪除（不刪紀錄）。
  - 旅程地圖 `#/trip/<id>`：每天一種顏色的路線（`MapView` 多了 `routes`）、總花費／公里／照片／紀錄、外幣合計、總步數、每天花費長條（點了到那天的回顧頁）。
- [x] 旅遊軌跡圖（`src/lib/poster.ts`，`#/trip/<id>/poster`）：canvas 畫 1080×1350（4:5）或 1080×1920（9:16）PNG；底圖（使用者 2026-11-19 要求把「只有路線」換掉）：**奶茶淡色地圖（預設）**＝跟地圖首頁一樣的 OpenFreeMap 向量地圖，用 MapLibre 在畫面外（opacity 0 的 div、preserveDrawingBuffer、pixelRatio 1、zoom 減 1 因為 512 px 圖磚）畫好、等 idle 再貼進 canvas，右下標 © OpenFreeMap © OpenStreetMap；**淡色地圖**＝OSM 圖磚＋米色 multiply＋淡底色。失敗時依序退到淡色地圖 → 只有路線並提示（圖磚全部載入失敗也算失敗）。開發環境用假的樣式（geojson 方塊）確認過貼上的位置和路線對得上；顯示花費（關掉改顯示步數）、顯示地名（每天離起點最遠、有地名的紀錄，同名或太近的不重複標）。按「分享／儲存到照片」叫出 iOS 分享選單。
- [x] 使用狀況（`src/pages/UsagePage.tsx`，`#/usage`）：雲端資料庫大小（`usage_stats()`＝`pg_database_size`，含固定開銷）＋各表筆數與大小、照片空間（Worker `GET /usage` 列 R2 `<user>/` 加總，最多 10 萬個檔）、照現在的速度還能用幾年（資料滿 14 天才估）、手機上的空間與筆數。流量不顯示（要管理金鑰）。
- [x] 測試：`src/lib/phase4.test.ts` 10 項、`worker/usage.test.js` 2 項，全部 102 項；`phase4.sql` 在本機 PostgreSQL 16 模擬 Supabase 跑過（可重複執行、別人看不到、anon 不能呼叫 usage_stats）；Playwright 模擬 iPhone 13 用假資料看過日曆、統計（月／年／展開分類）、設定、使用狀況、旅程列表／建議／新增／編輯／地圖、軌跡圖預覽與輸出的 PNG，沒有錯誤。
- [x] 發布：已合併到預設分支 `claude/confident-babbage-8nlxkb`（App 與照片伺服器都從那裡自動部署）。使用者 2026-11-19 同意：**以後功能做完、測試通過就可以直接合併到預設分支發布**（fast-forward）。
- [ ] 使用者要做：發布後到「統計 → 齒輪 → 使用狀況」按「複製設定 SQL」，在 Supabase SQL Editor 執行（建立 trips 表與 usage_stats）。
- [ ] 使用者 iPhone 實測：日曆、統計、旅程建議、旅程地圖、軌跡圖（特別是「淡色地圖」能不能出圖、分享選單能不能存進相簿）、使用狀況的數字。
- 沒辦法在開發環境確認的：OSM 圖磚實機能不能畫進 canvas（開發環境連不到）、iOS 分享選單存圖、Supabase 上 `pg_database_size` 的實際數字、Cloudflare 免費方案列 R2 的速度。
- [x] 2026-11-19 使用者實測：奶茶淡色地圖軌跡圖成功。
- [x] 每天顏色：使用者看過示意圖（介面預覽 15、16）後選「**咖啡色 10 色 × 實線／虛線**」（2026-11-19）：濃縮、肉桂、燕麥奶、杏桃奶茶、紅茶磚、黑糖、玫瑰可可、蜂蜜拿鐵、摩卡、焦糖（`DAY_COLORS`，順序排過讓隔天兩色 CIEDE2000 ≥ 15、任兩色 ≥ 12；使用者覺得第一版的前 3 個深咖啡太像，改成深色只留 1 個）；第 11–20 天同色虛線（`dayDashed`），超過 20 天才重複。地圖（Leaflet dashArray）、軌跡圖（setLineDash，圖例也畫虛線）、旅程縮圖、每天的小圓點（虛線圈）都有。原本 plan.md 的藍橘綠紫黃已不用。
- [x] 地圖出處：使用者選「可以關掉、出處寫在貼文裡」，要求先查清楚。開發環境連不到 osmfoundation.org／openstreetmap.org／openfreemap.org，只能用搜尋結果（多為草稿與第三方整理）：OSMF 2021 指引對靜態圖片的豁免只有「少於 100 個圖徵或面積小於 1 萬平方公尺」，旅遊軌跡圖不符合；較大的靜態圖片看起來要標在圖上，「寫在貼文裡」是否可以**沒有查到明確的官方允許**。OpenFreeMap 要求的完整字樣是「OpenFreeMap © OpenMapTiles © OpenStreetMap」。做法：出處改小、改淡（15px、75% 不透明），字樣補上 OpenMapTiles；加「顯示地圖出處」開關（預設開），關掉時提示「只自己留存可以關；要發到網路上建議打開」。
- [x] 軌跡影片（2026-11-19，照示意圖 12、13）：`poster.ts` 拆成 `prepare`（底圖只畫一次到 `base` 畫布、路線先投影並算累積長度）＋`drawFrame`（一格畫面）；圖片＝最後一格。影片時間軸 `videoFrameAt`：開場 1.5 秒（標題 0.8 秒淡入、地圖空的、數字 0）→ 一天一天畫（路線照長度畫出來、左上角「Day n · 小標題或日期」標籤、公里／照片／花費／步數照每天累加，地點數照比例）→ 最後 3 秒定格、地名出現。`recordVideo`：canvas.captureStream(30)＋MediaRecorder（優先 video/mp4 avc1，否則 webm，8 Mbps），錄的時候畫布放在預覽框裡邊錄邊看，requestAnimationFrame 畫，離開頁面就取消。軌跡圖頁上方切換「圖片／影片」；影片可選 9:16（預設）／4:5、10／15／20 秒；錄好可播放、分享／儲存、重新錄製。瀏覽器不支援 MediaRecorder 時提示只能輸出圖片。Playwright（Chromium）錄出 10 秒 1080×1920 MP4 約 650 KB。**iPhone 實機還沒測**（Safari 的 MediaRecorder 輸出、存相簿、錄影時螢幕不能關）。
- [x] 旅程可以由好幾段不連續的日期組成（2026-11-19，照示意圖 14）：`Trip.segments`（好幾段 start/end；只有一段時不存，舊資料相容）、`start`/`end`＝最早／最晚；小標題改存 `titles`（key 是日期，日期增減不會對錯天；舊的 `dayTitles` 照順序對應，儲存時轉成 titles）。`trips.ts`：`normalizeSegments`（排序、重疊或相連就合併）、`tripSegments`、`tripDates`（只算有出門的日子）、`tripDaysText`（「7 天（3 段）」）、`mergeTrips`。統計只算旅程裡的日子（中間沒出門的日子的紀錄不算）；自動建議檢查每一段有沒有重疊。編輯頁：每段一列（第 n 段 ✕＋兩個日期）、「＋ 加一段日期」（預設接在最後一段後一天）、「＋ 併入其他旅程」（勾選，儲存時把被併入的旅程刪掉，紀錄照片不動，小標題與封面帶過來）；最多 90 天。旅程地圖與編輯頁每段之間有虛線分隔；日曆每段各一條橫條。
- 注意：`poster.ts` 會載入 `mapStyles.ts`，它一載入就讀 IndexedDB；單元測試只能 import 不碰資料庫的檔案（影片時間軸因此放在 `posterTimeline.ts`）。2026-11-19 曾因此讓 GitHub Actions 的測試失敗、發布中斷一次，已修。
- [x] 路線改善（2026-11-19 討論後使用者確認開工；騎**機車**，來回同一條路畫成兩條線，原因是 Overland 30 秒一點、時速 30～40 km 時點距 250～330 m，直線連接抄捷徑。不做：更耗電的設定、自動認出家、更嚴的過濾）：
  - **接上前一天的最後位置**（`legs.ts` 的 `carryPoint`／`withCarry`，`db.getTrackBefore` 看前 14 天）：前一天最後一個可用的背景定位點，變成今天 0 點的「延續點」（`TrackPoint.carriedFrom`，不存檔、只在地圖頁用）。今天沒收到點時地圖顯示「整天在這裡（最後更新 11/16 22:10）」，面板寫「背景定位 11/16 22:10」；今天有出門時路線從那裡開始、「出發」標記用第一段的出發時間。
  - **一天切成好幾段移動**（`computeLegs`）：停留之間的空檔是一段，少於 200 m 不算；每段有距離、時間、平均／最高時速（最高時速只看相隔 20 秒以上的兩點）。時間軸多了「移動 · A → B（距離 · 時間 · 交通方式）」那一列，「離開 ○○」併進去。點那一列或點地圖上的線（`MapView` 的 `routes` 可以帶 id、看不見的粗線好點）就只亮那段（深咖啡、其他變淡）、地圖對準那段（`focus`）、面板收到 150 px，上方卡片：時間、距離、花了、平均、交通方式、上一段／下一段／看全天。
  - **交通方式**：自動判斷（`guessMode`：平均 < 7 km/h＝走路、最高 > 90 km/h＝不貼齊、其他＝預設）；卡片上可手動改（存 meta `route.legModes`，key＝日期/段 id＝`leg-<出發毫秒>`）；設定頁「路線」：貼齊道路開關、預設交通方式（預設機車），存 meta `route.settings`。
  - **貼齊道路**（`snap.ts`）：GET `https://valhalla1.openstreetmap.de/trace_route?json=`（`encoded_polyline` 6 位小數、`shape_match: map_snap`、costing：機車 motor_scooter／汽車 auto／走路 pedestrian／公車 bus），每次間隔 1.1 秒、一次最多 250 點（太長切開）；結果存 meta `snap.<mode>.<點的雜湊>`，同樣的點不再送；失敗記下來 1 小時內不重試、畫原本的直線；貼齊後比原本長 2.5 倍以上＝比對錯了，不用。地圖左上角小標籤：已貼齊道路（機車）／貼齊道路中…／部分路段沒有貼齊。
  - 測試：`src/lib/legs.test.ts` 7 項（切段、飄移不算、猜交通方式、延續點、polyline 編解碼、Valhalla 假伺服器＋快取＋失敗），全部 116 項；Playwright 用假的 Valhalla 回應看過切段、選一段、改交通方式、延續點、設定頁。
  - 2026-11-19 使用者 iPhone 實測：**貼齊道路成功，路線「準確多了」**（Valhalla 從 iPhone 連得到）。
- [ ] 2026-11-21 使用者回報兩個問題（第 1 個已修改待實測、第 2 個待使用者回覆）：
  1. **短距離走路沒畫進路線**：截圖是 11/21 09:57，面板「背景定位 07:59」、0.2 km。App 端可能吃掉短距離的地方：停留半徑 150 m（家附近 150 m 內走來走去整段都算在「停留」裡，沒有移動段）、一段少於 200 m 不算（`MIN_LEG_M`）、移動距離小於精確度的點不畫（`cleanPath`，Overland 精確度設 100m 時走路的點常是 ±30～65 m）。Overland 端可能根本沒記到。為了分辨，加了設定頁「路線」→「顯示原始定位點」（`RouteSettings.rawPoints`，`MapView` 的 `dots`：藍點＝收到的點、灰點＝精確度 > 200 m 不採用，點一下看時間與精確度）。**等使用者打開看那段走路有沒有藍點**，再決定改 App 的過濾（有點）或改 Overland 設定（沒點）。
     - 使用者判斷是 App 過濾掉（有路線就表示 Overland 有在送），**已放寬**（2026-11-21）：
       - 停留半徑改成看每個點的精確度：`stayRadiusFor`＝精確度 × 1.5，夾在 50～150 m（以前固定 150 m）。準的 GPS 點離開 50 m 就算走開。
       - 同一個地方被飄出去的點切成兩段停留時合回一段（`mergeSameSpot`：兩段中心 ≤ 50 m，中間走遠的點少於兩個）。
       - 一段最短從 200 m 改 80 m；80～200 m 的短段要通過 `reallyMoved`（有點離出發／抵達處 ≥ 60 m 且 ≥ 精確度 × 1.5，最高時速 ≥ 2.5 km/h），擋掉在家的飄移。
       - 切好的段裡飄移門檻從「精確度（至少 25 m）」改成「精確度，夾在 15～40 m」（`cleanPath` 的 maxStep／minStep），走路時 ±30～65 m 的點不會整段被丟光。整天的公里數（`buildRoute`）仍用舊門檻，避免在家飄移灌水 → **面板的公里數可能沒有包含短的走路段**，看使用者在不在意。
       - 測試加 3 項（巷口來回 150 m 停 3 分鐘＝一段走路；在家 ±65 m 飄移不算出門；單一點飄到 70 m 外不切成兩段），全部 119 項。
       - 待使用者實測：短距離走路有沒有出現；在家有沒有冒出假的「移動」段。
       - 2026-11-21 經使用者同意 fast-forward 合併到預設分支 `claude/confident-babbage-8nlxkb`，GitHub Actions 發布成功。使用者用 11/21 早上的軌跡實測（App 打開時用手機上的點重算，不用重新收資料）。
     - 使用者實測（11/21）：走路段出現了，但**只有點到點的直線，沒有貼齊道路**。原因（Valhalla 官方文件，從 GitHub 原始碼 docs/docs/api 讀）：map matching 要 1～10 秒一點，Overland 是 30 秒一點、走路點又 ±30～65 m，而我們沒給精確度（Valhalla 預設當成很準），比對失敗就畫直線。改法（`snap.ts`）：
       - trace_route 加 `trace_options`：`gps_accuracy`＝點的精確度中位數（5～100）、`search_radius`＝1.5 倍（30～100，文件說最大 100）、走路且精確度 > 20 m 時 `turn_penalty_factor: 500`（文件建議減少走路來回抖）；另附 `begin_time`／`durations`。
       - 比對失敗的備案：`/route` 把點（最多 20 個，`thin` 平均挑、留頭尾）當途經點沿道路規劃；中間點用 `via`（可迴轉、不分段，走去巷口再走回來畫得出來）。結果一樣要通過「不比原本長 2.5 倍以上」的檢查。
       - 快取 key 改 `snap2.`，以前失敗記錄的段會重試。
       - 開發環境連不到 Valhalla，只用假伺服器測（加 2 項，全部 121 項）。待使用者實測。
     - 使用者實測：機車段「已貼齊道路」，**走路那段只有原始點、沒有線**（＝還是沒被算成一段移動，被停留或短段檢查吃掉）。加了除錯按鈕：開「顯示原始定位點」時，地圖面板上方「複製這天的原始定位點」（每行 時間,緯度,經度,精確度），請使用者貼過來用真實資料調整規則。
     - 用使用者貼來的 11/21 原始點（44 點）找到原因並修好（`src/lib/realday.test.ts`，座標整體平移到假位置，不含真實位置）：早上 07:18 從家往西走約 90 m 到早餐店、待到 07:56、走回家。停留半徑會把走路中的點吃進停留裡，兩個停留之間只剩 1～2 個點、距離 < 80 m → 被丟掉。改法（`legs.ts`）：
       - 移動段頭尾接上停留的中心（`stayPoint`），從哪出發、到哪都接得起來。
       - `distinctStays`：前後兩個停留相距 ≥ 60 m 且換算時速 ≥ 0.5 km/h（擋掉慢慢飄移）＝一定是一段移動，不受 80 m 最短距離限制。
       - `guessMode`：最快時速 < 12 km/h＝走路（點少的短段平均時速會被灌高，07:17 那段兩點算成 8.6 km/h 被當成機車）；平均 < 7 但最快 ≥ 25＝騎車中間有等，不當走路。
       - 結果：早上兩段走路＋晚上 22:16 騎車一段。全部 123 項。
       - 也看到：07:59～22:14 Overland 完全沒送點（在家不動，Min Distance 10m 把點丟掉），但定位一直開著——跟耗電有關。
  - 小工具路線縮圖加地圖底圖（2026-11-21，使用者回報「只顯示路線沒有地圖」）：腳本版本 2026-11-21.1，`routeImage` 改成 async，用 OSM 圖磚（`tile.openstreetmap.org`，跟 App 的 OSM 奶茶同來源）：找放得下整條路線的最大縮放層級（最多 17）、256 px 圖磚畫成 128 點（3 倍螢幕清楚）、蓋一層半透明奶茶色（DrawContext 沒有 multiply）、路線加白邊、右下「© OpenStreetMap」。圖磚存在 Scriptable 的 cacheDirectory `ledger-tiles/`，14 天內不重抓，載不到就用舊的，都沒有就只畫路線。User-Agent 設成 `KoukouLedgerWidget/1.0`。開發環境連不到 OSM，用 Playwright＋假的 Scriptable API＋假圖磚看過位置正確（一段 1.4 km 的路線用 z14、2 塊圖磚）。**使用者要重新複製腳本貼到 Scriptable**。
  - 2026-11-21 使用者已把捷徑改名「打開摳摳手帳」，並自己改了 Scriptable 腳本（**我漏改，使用者說下不為例**）。範本 `OPEN_SHORTCUT` 改成「打開摳摳手帳」，腳本版本 2026-11-21.2，setup-automation.md 一起改。**教訓：改到 Scriptable 腳本或捷徑相關的東西時，先確認使用者手機上現在的名稱（捷徑名稱、腳本名稱），範本要跟著改。**
  - 2026-11-21 使用者實測：早上兩段走路出現了（07:18、07:58 各一段 0.1 km 走路）。但晚上 22:22 騎過頭在路中迴轉，貼齊道路（機車）**繞街區一圈**（Valhalla 不允許路中迴轉）。改法：`snap.ts` 的 `fixDetours`——貼齊後離實際的點（折線）超過 50 m 的幾段（中間只隔 60 m 以內正常線的併成一段），**而且**那段貼齊的長度 > 照實際的點走 × 1.5 + 100 m（真的繞一圈；30 秒一點時兩點之間本來就彎的路不改），改成照實際的點畫；繞路結束點只往後找（迴轉去回同一條路）。快取裡的舊結果讀出來時也套用，不用重新送 Valhalla。測試加 3 項（繞街區、沒繞路不動、彎路不算繞路），全部 126 項。
   - 使用者回報還是繞圈（「那段沒有原始點，應該很好判斷」）。從截圖量，那個街區只有約 47 × 55 m，剛好在 50 m 門檻邊緣、長度條件也太嚴。改成：離實際路線 > 25 m 算偏離、長度條件 × 1.5 + 40 m；而且依序沿著實際路線比對（只往後找，去回同一條路時取較早那段，`SAME_ROAD_M` 10 m），以前迴轉處會被算到回程、實際長度算錯。加測試（47 × 55 m 小街區），全部 127 項。「複製原始定位點」也會附上每段畫出的線（貼齊後的點），之後可用真實貼齊結果測。
   - 使用者第二次貼的資料沒有「畫出的線」＝手機還是舊版（主畫面 PWA 很少自己檢查新版，要冷啟動兩次，GitHub Pages 還有約 10 分鐘快取）。之後使用者回報「更新了／沒事」。改善：`main.tsx` 每次回到 App（visibilitychange）與每 30 分鐘呼叫 `registration.update()`，新的 Service Worker 接手（controllerchange）就自動重新載入（`#/entry` 新增／編輯紀錄時不重載）；設定頁底部的建置時間改成台灣時間到分鐘（`__BUILD_DATE__`），用來確認手機是不是新版。
   - 換成新版後繞圈消掉，但迴轉處還有**小三角**。使用者貼了實際畫出的線：繞街區剩下最後一個點 25.040082,121.452549 離實際路線只有約 18 m（< 25 m 門檻）被留下。加 `removeSpikes`：線在某點折回（夾角 < 60°）且那點離實際路線 > 10 m 就拿掉（一般路口約 90° 不受影響），`tidySnapped`＝修繞路＋拿尖刺，快取的結果讀出來也套用。`realday.test.ts` 加入那條實際的線（平移）：三角形的點不見、前 60 點不動、迴轉後沒有點偏東 > 12 m。全部 128 項。
   - 23:09–23:34 找停車位繞一圈（往西到 121.4481、往北到 25.0543 再繞回家），**整圈沒畫出來**：是我加的 `fixDetours` 造成的——沿實際路線依序比對時，第一次經過家附近的貼齊點離「第二次經過家」那段更近，位置一下跳到結尾，中間整圈都被當成繞路換掉。修正：每個點最多只能往前推進「貼齊的線走過的距離 × 1.5 + 100 m」（`maxSeg`）。用使用者的原始點（平移）重現並加測試，全部 129 項。**教訓：改貼齊後處理要用「同一個地方經過兩次」的資料測。**
   - **使用者定的原則（2026-11-21）：實際收到的定位點是事實，路線一定要經過每一個點、一個都不能丟；貼齊道路只用來補兩點之間怎麼走。不能為了好看把事實改掉。** 之前的 `fixDetours`／`removeSpikes`（先貼齊再東補西補）會把真的點丟在路線外，已整段拿掉，改成 `alignToRaw`（`tidySnapped`）：依序找每個點在貼齊線上的位置（容許距離＝精確度 × 1.5，夾在 20～50 m，只往後找、最多往前「跟上一點直線距離 × 3 + 150 m」）；輸出＝每個實際的點原封不動，相鄰兩點都被經過、而且那段貼齊線長度 ≤ max(直線 × 1.4, 直線 + 40 m) 才插入貼齊線的中間點，否則直線連（迴轉繞街區自然變成照實際的點折返）。測試：每個實際的點都在路線上、迴轉不繞街區、彎路照貼齊、漏掉的點會經過；真實資料（晚上那段）超過 7 成仍沿貼齊道路畫。全部 129 項。
   - 使用者提的迴轉判斷：「下一個點在上一個點後面就是迴轉」。加進 `alignToRaw`：前後兩段方向夾角 > 135°（兩段都 ≥ 5 m）＝迴轉點，迴轉點前後那段貼齊線要 ≤ 直線 × 1.15 + 15 m 才用（一般段維持 × 1.4／+40 m，免得把正常彎路拉直）。加測試（迴轉處只多繞 30 m 的小圈也照實際的點折返），全部 130 項。
   - 2026-11-22 使用者手繪 11/21 23:20～23:34 的實際路線。把原始點疊上去（用中信街、北63-1、中榮街、家校正比例）：**原始點幾乎都在手繪路線上**，差異在點和點之間（30 秒一點）與走路回家時 32:56、33:30 兩點飄到中港路對面（誤差圈 14～19 m 跨過馬路）。使用者另外指出「同一條路直線往返多出突出的折線」（上一版硬畫在點的正中心）。修正：
     - `alignToRaw`：貼齊線在點的誤差範圍內經過 → 畫在路上的位置（點本來就有誤差，不算改事實）；沒經過的點照原位置。相鄰兩點之間的貼齊線長度上限改成 max(直線 × 1.4, 直線 + 40, 這段時間 × 前後最快速度 × 1.3)（30 秒內繞進巷子也照貼齊畫）；迴轉點前後仍是 × 1.15 + 15。
     - `dropWobble`（legs.ts，切段時套用）：點離前後連線偏 5 m 以上、但 ≤ 自己精確度（最多 25 m）＝飄移，畫線時跳過；之前跳過、夾在中間的點也要還在新連線的誤差範圍內（避免連續跳點把轉角削掉）。原始點本身不改（除錯點照樣顯示）。
     - 測試加 5 項（實際走路那段 32:56 被跳過、轉彎不跳、直線往返沒有折線、30 秒內繞巷子照貼齊），全部 134 項。
   - 使用者回報：還是沒照手繪路線，而且開始出現不貼齊地圖的線。**我連續幾版在看不到真實貼齊結果的情況下調規則，越改越亂。** 改做法：「複製原始定位點」多附每段「這段用的點」（含時間、精確度）與「貼齊服務原始回傳」（`getSnapCache`，存在手機 meta 的 Valhalla 結果），之後在開發環境用使用者手繪路線當標準答案離線調好再發布。iPhone Safari 剪貼簿要在按下當下開始寫，改用 `ClipboardItem` 傳 Promise。
   - 使用者要求：地圖頁面板固定顯示 App 版本，放在「背景定位」後面 → 加「版本 11/22 00:39」（`APP_VERSION`，由建置時間 `__BUILD_DATE__` 台灣時間來），每次更新後看這行就知道有沒有換成新版。
   - 使用者回報：小工具在「今天只有昨天最後一點」時不顯示現在位置（顯示「今天還沒有軌跡」）。`worker/auto.js` 的 `/widget`：今天沒有可用的點時，讀前 7 天的 track_points，取最後一個可用的點（`carryFrom`）當目前位置放進 route → 小工具顯示「今天在 ○○」。跟 App 地圖頁的延續點一樣。Worker 測試加 1 項（19 項）。Worker 由 Cloudflare 從預設分支自動部署，**腳本不用重貼**。
   - 拿到 11/21 的 Valhalla 原始回傳，疊在使用者手繪路線上比對：中榮街、中信街、北63-1、中港路大致對；**錯在家附近**（25:14～26:47）同一個小圈繞兩次、走到更西邊的斜路（單行道／禁止迴轉逼出來的）。App 的後處理遇到怪繞路就改直線，反而出現不貼齊地圖的線（例：23:11→23:20 停了 8 分鐘，Valhalla 往北繞一圈被拒，畫成 250 m 直線）。修正：trace_route 與 route 的機動車 costing 加 `costing_options.<costing> = { ignore_oneways, ignore_restrictions, ignore_access }`（官方文件說特別適合 GPS 軌跡比對；pedestrian 不加），快取 key 改 `snap3.` 全部重算。開發環境連不到 Valhalla，要等使用者再貼一次比對。
   - 使用者第二次貼（開了 ignore_* 之後）：第 3 段迴轉處 Valhalla 直接原路折返（有效）；第 4 段 Valhalla 回傳完全一樣，家附近仍繞圈 → 是 30 秒一點太稀，不是單行道。使用者提三件事，都做了：
     1. **騎車中途停車走路要切開**（`splitByMode`，legs.ts）：同一段移動裡連續 ≥ 3 個間隔走路速度（< 7 km/h）、合計 ≥ 90 秒、≥ 60 m，且這段別處有騎車速度（≥ 15 km/h）就切開；相隔 > 90 秒的間隔（停著等）不算。切點名稱「停車處」／「取車處」（`Leg.fromLabel/toLabel`）。真實資料測試：23:09–23:30 機車＋23:30–23:34 走路；23:25 家附近巷子裡慢騎（只有 2 個慢的間隔）不切。
     2. **點多一點**：要改 Overland 的 Min Time Between Points（選項 1s／5s／10s／30s…，從 Overland 原始碼確認）。建議 10 秒（Valhalla 文件說 1～10 秒一點最好）。定位本來就一直開著，Min Time 只是丟掉多的點，預期耗電增加不多，但要使用者觀察。
     3. **使用者自己修改路線**：路段卡片「手繪修改路線」→ 卡片縮成一行提示＋取消，一根手指在地圖上畫（`MapView` 的 `drawMode`／`onDrawEnd`，capture 攔 pointer 事件；兩指照樣縮放，畫到一半第二根手指放上來就取消這一筆）→ `snapDrawn`：8 m 內的點去掉，trace_route（gps_accuracy 15、search_radius 40）貼齊，失敗或繞太遠就用畫的線 → 存 meta `route.legEdits`（key 日期/段 id，**只存在手機上、不同步**，跟手動交通方式一樣）。有修改時卡片顯示「重新手繪」「還原自動路線」，距離改用畫的線算。Playwright（iPhone 13）用 11/21 的點試過：切成兩段、按手繪、畫線、取代路線、出現還原；兩指縮放沒辦法在 Playwright 測，要實機確認。
     - 全部 137 項測試。
   - 使用者：「讓路線的斷點增加，不然手繪路線要好長一條」→ 改成**局部手繪**（`spliceLine`）：畫的線頭尾各找目前路線上最近的位置，只換掉中間；頭尾離目前路線 > 80 m 才整段換；反方向畫也可以。可以一段一段改（每次接在目前的線上），按鈕改「再修改一段」。地圖對焦改看這段的定位點（`focus={pickedLeg.points}`），`MapView` 有對焦目標時只有目標換了才重新縮放（`lastFit`），修改後使用者放大的畫面不會被重設。測試加 3 項（全部 140）；Playwright 試過局部修改（前後保留、中間換掉）與修改後畫面不跳。
   - 已知：時間軸的停留地名只到「中信里 · 新北市」（iOS／Nominatim 反查到里），早上兩段都寫「中信里 → 中信里」。使用者還沒提。
  - 耗電（第 2 點）使用者目標：**一天 10% 以下、而且不影響程式運作**（短距離走路還要抓得到）。Overland 的 Auto-Stop 是 2026-10-29 才加進原始碼（在 1.4 版號之後），App Store 版本有沒有還不確定（開發環境連不到 apps.apple.com）。待討論。
  2. **Overland 21 小時耗電 14%**（11/19 量到的是背景 21 時 18 分占 7%）。Overland 官網（overland.p3k.app）在開發環境連不到，改看 GitHub 原始碼（aaronpk/Overland-iOS，1.4 版，2026-11-12）：「Standard」模式＋不暫停＝整天開著定位，連在家睡覺也是，這是主要耗電來源；Min Distance／Min Time／Discard points while stationary 只是丟掉點、不會關定位，不省電。新版有 **Auto-Stop Radius／Auto-Stop After**（在半徑內待滿設定時間就關掉定位，靠「重大位置變更」或 Resume with Geofence 的圍欄離開時再開），這是省電的正解，但代價是離開時要走出圍欄（最小 100 m，iOS 圍欄偵測常常更晚）才恢復，**短距離走路會更容易漏掉**，和問題 1 互相衝突，要使用者選。App Store 上的版本有沒有 Auto-Stop 還沒確認（請使用者看設定頁有沒有這兩項）。
- 掃發票先不做；停留提醒、軌跡精簡不做（見上）。

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
