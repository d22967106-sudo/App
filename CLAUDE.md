# 記帳日記 App

自用的 iOS App：記帳＋日記＋照片＋生活軌跡，以地圖為主畫面。

- **前提**：沒有 Mac、不簽署、不花錢 → 做成 **PWA**，用 GitHub Pages 發布，在 Safari「加入主畫面」使用。
- **完整規劃與所有決定**：`docs/plan.md`（開始工作前先讀）
- **目前進度**：`docs/progress.md`（從這裡知道做到哪、下一步做什麼）
- **介面預覽圖**：https://claude.ai/artifact/MoLY5v8m1ALEKzBC1dL9Ff （用 Artifact 工具的 read 讀取）

## 工作規則

- 介面文字一律使用**繁體中文**，與使用者溝通也用繁體中文。
- 已經討論定案的事情（見 `docs/plan.md`）不要重新提議別的方案，除非遇到技術上做不到的情況，並說明原因。
- 每次工作結束前：更新 `docs/progress.md`（勾選完成項目、記下做到哪、已知問題），然後 commit 並 push。
- 不要把任何金鑰、密碼寫進程式碼或 repo（Supabase anon key 例外，它本來就是公開的，安全靠 RLS）。
- 一個階段做完再進下一個階段；使用者會在 iPhone 上實測後回饋。
