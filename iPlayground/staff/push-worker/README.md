# IMS Web Push Worker

這個 Worker 僅供第一階段測試：接收瀏覽器 Push Subscription，並在 15 秒後送出「報到桌佈置」系統通知。

15 秒測試會由 Worker 的背景工作直接送出；每分鐘執行一次的 Cron 則作為漏送備援，並供後續正式任務排程使用。送出前會先將提醒標記為 `sending`，避免背景工作與 Cron 重複發送。

## iPhone 測試條件

- 使用 iOS 16.4 以上版本。
- 必須先用 Safari 將網站加入主畫面。
- 必須從主畫面的 IMS 圖示開啟網站。
- 通知授權必須由使用者點擊提醒開關後觸發。
- 專注模式或勿擾模式仍可能隱藏通知。

## 尚未部署前

`wrangler.jsonc` 內的 D1 `database_id` 必須在建立資料庫後填入。

前端 `assets/push-config.js` 的 `apiBase` 已設定為：

`https://iplayground-reminders.gztin-iplayground.workers.dev`

## 部署順序

所有遠端操作都應在使用者確認後執行。

1. 安裝依賴：`npm install`
2. 登入 Cloudflare：`npx wrangler login`
3. 建立資料庫：`npx wrangler d1 create iplayground-reminders`
4. 將回傳的 database ID 填入 `wrangler.jsonc`
5. 建立遠端資料表：`npx wrangler d1 execute iplayground-reminders --remote --file schema.sql`
6. 第一次部署：`npx wrangler deploy`
7. 產生 VAPID 金鑰：`npx web-push generate-vapid-keys --json`
8. 設定 Secrets：
   - `npx wrangler secret put VAPID_PUBLIC_KEY`
   - `npx wrangler secret put VAPID_PRIVATE_KEY`
   - `npx wrangler secret put VAPID_SUBJECT`，值使用 `mailto:` 開頭的聯絡信箱
9. 將部署後的 `workers.dev` 網址填入 `../assets/push-config.js`

## 本機檢查

- JavaScript 語法：`npm run check`
- Cron 測試：`npm run dev` 後請求 `/__scheduled`

VAPID 私鑰不可寫入 Git、`wrangler.jsonc` 或前端檔案。
