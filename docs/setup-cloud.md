# 雲端設定教學（第 2 階段）

全部在 iPhone 的 Safari 就能完成，大約 20～30 分鐘。帳號都是你自己的，密碼不用告訴任何人。

會用到兩個免費服務：
- **Supabase**：存紀錄、日記、軌跡（文字資料），也負責登入。
- **Cloudflare R2**：存照片；搭配一個小程式（Worker）負責檢查「是不是你本人」再存取照片。

> 下面的「複製檔案內容」都可以用這個方法：打開連結 → 長按文字 → 全選 → 拷貝。

---

## A. Supabase（文字資料＋登入）

### A1. 建立專案
1. 打開 https://supabase.com → **Start your project** → 用 GitHub 登入（最簡單）。
2. **New project**：
   - Name：`ledger-diary`（隨便取）
   - Database Password：按 **Generate a password**，存到 iPhone 密碼（App 用不到，但之後管理可能要用）
   - Region：**Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**（離台灣近）
   - Plan：**Free**
3. 按 **Create new project**，等 1～2 分鐘建好。

### A2. 建立資料表（貼一段 SQL）
1. 左邊選單 **SQL Editor** → **New query**。
2. 複製這個檔案的全部內容貼上：
   https://raw.githubusercontent.com/d22967106-sudo/App/claude/start-phase-two-wqljng/supabase/schema.sql
3. 按 **Run**。看到 `Success. No rows returned` 就完成了。
   （這段 SQL 建了 5 張表，並設定「每個人只能讀寫自己的資料」。重複執行也沒關係。）

### A3. 讓登入信顯示「數字驗證碼」
App 加入主畫面後，信裡的登入「連結」會開到 Safari 而不是 App，所以要改成寄**數字驗證碼**。

1. 左邊選單 **Authentication** → **Emails**（或 **Email Templates**）。
2. 點 **Magic Link**，把 **Body** 全部換成：
   ```html
   <h2>記帳日記登入驗證碼</h2>
   <p>你的驗證碼是：<strong style="font-size:24px">{{ .Token }}</strong></p>
   <p>如果不是你本人要登入，請忽略這封信。</p>
   ```
   Subject 可以改成 `記帳日記登入驗證碼`，按 **Save**。
3. 再點 **Confirm signup**，Body 一樣換成上面那段，按 **Save**。（第一次登入時寄的是這一封。）

### A4. 複製網址和公開金鑰
1. 左下 **Project Settings**（齒輪）→ **API Keys**（或 **Data API**／**API**）。
2. 記下兩個值（等一下貼到 App）：
   - **Project URL**：像 `https://abcdefgh.supabase.co`（在 **Data API** 或 **General** 頁面）
   - **Publishable key**（`sb_publishable_…`）；如果只看到 **anon public**（`eyJ…` 很長一串）也可以用。
   - ⚠️ **不要**用 `service_role` 或 `secret` 那把，那是管理員金鑰。

### A5.（登入成功之後再做）關閉註冊
等你在 App 裡第一次登入成功後：**Authentication** → **Sign In / Providers**（或 **Providers**）→ 關掉 **Allow new users to sign up** → Save。這樣別人就算拿到網址也無法註冊。

---

## B. Cloudflare（照片）

> 照片伺服器可以晚點再做：只設定 Supabase 的話，文字資料會先同步，照片留在手機上，設定好後自動補傳。

### B1. 註冊與開通 R2
1. 打開 https://dash.cloudflare.com/sign-up 註冊（免費方案）。
2. 左邊選單找 **R2 Object Storage**（在 **Storage & Databases** 底下）。
3. 第一次使用可能會要求**開通 R2**。免費額度是 10 GB、下載不收費，用量在額度內不會收錢。
   ⚠️ **如果它要求填信用卡才能開通**，先停在這裡回報給我，我們再討論改用其他存放方式（例如 Supabase 自己的儲存空間，免費 1 GB）。

### B2. 建立儲存桶（bucket）
1. R2 → **Create bucket**。
2. Name：`ledger-photos`，Location：Automatic，Storage class：**Standard**。
3. 按 **Create bucket**。**不要**開啟 Public access（照片只透過下面的 Worker 存取）。

### B3. 建立 Worker（照片伺服器）
1. 左邊選單 **Workers & Pages**（在 **Compute** 底下）→ **Create** → **Create Worker**（或 **Start with Hello World!**）。
2. Name：`ledger-photos` → **Deploy**。
3. 部署完按 **Edit code**，把左邊 `worker.js` 的內容**全部刪掉**，換成這個檔案的全部內容：
   https://raw.githubusercontent.com/d22967106-sudo/App/claude/start-phase-two-wqljng/worker/photos.js
4. 按右上 **Deploy**。

### B4. 連接儲存桶與設定變數
回到這個 Worker 的頁面 → **Settings**：
1. **Bindings** → **Add** → **R2 bucket**
   - Variable name：`PHOTOS`（一定要大寫、一字不差）
   - R2 bucket：`ledger-photos`
   - 按 **Add Binding**／**Deploy**
2. **Variables and Secrets** → **Add**
   - Type：Text，Variable name：`SUPABASE_URL`，Value：A4 的 Project URL
   - 再 **Add** 一個：Type：Text，Variable name：`SUPABASE_KEY`，Value：A4 的 publishable／anon key
   - 按 **Deploy**
3. 回到 Worker 頁面，複製它的網址（像 `https://ledger-photos.你的名稱.workers.dev`）。
4. 在 Safari 打開「那個網址 + `/health`」，例如 `https://ledger-photos.你的名稱.workers.dev/health`：
   - 顯示 `ok` → 成功
   - 顯示「設定不完整」→ 回去檢查 B4 的名稱有沒有打錯

---

## C. 在 App 裡設定

1. 打開記帳日記 → 底部 **統計** → **雲端同步**。
2. 貼上：Supabase 網址、公開金鑰、照片伺服器網址 → **儲存**。
3. 輸入電子郵件 → **寄驗證碼** → 到「郵件」App 複製數字 → 回 App 貼上 → **登入**。
4. 登入後會自動開始同步。手機上原有的資料（第 1 階段記的）會全部上傳；照片會一張一張傳，傳完後大圖改放在「大圖暫存」，手機只永久留縮圖。
5. 確認：
   - Supabase → **Table Editor** → `entries` 看得到你的紀錄。
   - Cloudflare → R2 → `ledger-photos` 看得到照片檔（資料夾名稱是一串亂碼，那是你的使用者 id）。
6. 做 A5：關閉註冊。

## 常見問題

- **寄驗證碼說「寄信太頻繁」**：Supabase 免費版內建的寄信服務每小時只能寄幾封，等一陣子再試。登入一次後會一直保持登入，不常需要寄。
- **信裡只有連結、沒有數字**：A3 沒改到，或改的是另一個範本。兩個範本（Magic Link、Confirm signup）都要改。
- **同步顯示「找不到資料表」**：A2 的 SQL 沒有執行成功，再執行一次。
- **照片一直沒上傳**：看「雲端同步」區塊的訊息；確認「暫停照片上傳」沒有打開、照片伺服器網址的 `/health` 顯示 ok。
- **Supabase 一週沒用會暫停**：之後第 3 階段的自動上傳會讓它保持活動。暫停了的話到 Supabase 後台按 **Restore** 即可，資料不會不見。
