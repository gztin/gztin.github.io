# IMS Web Push Worker

這個 Worker 僅供第一階段測試：接收瀏覽器 Push Subscription，並在 15 秒後送出「報到桌佈置」系統通知。

## 尚未部署前

`wrangler.jsonc` 內有兩個待替換值：

- `REPLACE_AFTER_D1_CREATE`
- `REPLACE_WITH_VAPID_PUBLIC_KEY`

前端 `assets/push-config.js` 的 `apiBase` 也必須在 Worker 部署後填入。

## 部署順序

所有遠端操作都應在使用者確認後執行。

1. 安裝依賴：`npm install`
2. 登入 Cloudflare：`npx wrangler login`
3. 建立資料庫：`npx wrangler d1 create iplayground-reminders`
4. 將回傳的 database ID 填入 `wrangler.jsonc`
5. 產生 VAPID 金鑰：`npx web-push generate-vapid-keys --json`
6. 將 public key 填入 `wrangler.jsonc`
7. 建立遠端資料表：`npx wrangler d1 execute iplayground-reminders --remote --file schema.sql`
8. 第一次部署：`npx wrangler deploy`
9. 設定 Secrets：
   - `npx wrangler secret put VAPID_PRIVATE_KEY`
   - `npx wrangler secret put VAPID_SUBJECT`，值使用 `mailto:` 開頭的聯絡信箱
10. 將部署後的 `workers.dev` 網址填入 `../assets/push-config.js`

## 本機檢查

- JavaScript 語法：`npm run check`
- Cron 測試：`npm run dev` 後請求 `/__scheduled`

VAPID 私鑰不可寫入 Git、`wrangler.jsonc` 或前端檔案。
