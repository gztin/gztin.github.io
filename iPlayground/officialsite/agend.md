# Agenda Modal 規格與需求整理

## 目標
- 在議程 Modal 中，於 `HackMD` 按鈕旁新增 `線上看` 按鈕。
- `線上看` 按鈕需支援中英語系顯示，並可由議程 JSON 的影片欄位帶入連結。

## UI/樣式需求
- 新增按鈕名稱：
  - 中文：`線上看`
  - 英文：`Watch Online`
- `線上看` 按鈕需有播放 icon（在文字前方）。
- `線上看` 按鈕樣式：
  - 背景色：`#FFA143`
  - 文字色：黑色
  - icon 顏色：黑色
- 按鈕位置：
  - 與 `HackMD 共筆`（英文為 `HackMD Notes`）並排顯示。

## 文案語系需求（i18n）
- `HackMD` 按鈕文案需依語系切換：
  - 中文：`HackMD 共筆`
  - 英文：`HackMD Notes`
- `線上看` 按鈕文案需依語系切換：
  - 中文：`線上看`
  - 英文：`Watch Online`

## 資料帶入需求（JSON）
- 每個講者/場次都應可帶入影片連結欄位。
- `線上看` 按鈕連結來源優先順序：
  1. `item.watch`
  2. `item.video`
  3. 其他相容欄位（已補強）：`videoUrl`、`videoURL`、`youtube`、`youtubeUrl`
  4. 若都不存在，fallback 至 YouTube 首頁：`https://youtube.com/@iplaygroundtaiwan`

## 已觀察到的資料來源現況
- 畫面議程資料目前主要由遠端 `SessionData` 的 `schedule.json / schedule_en.json` 載入。
- 本機 `data/iplayground_agenda.json` 目前檢查結果沒有 `video` 欄位內容（`rows_with_video = 0`）。
- 因此目前畫面多數情況會 fallback 到 YouTube 首頁，屬於資料來源未提供影片欄位所致。

## 快取更新需求
- 已要求使用 query string 方式強制更新，例如 `?v=1`、`?v=2`。
- CSS 檔案亦需帶版本參數，以避免舊樣式快取影響顯示。

## 待確認/後續建議
- 是否要改為「優先讀本機 agenda JSON，失敗才 fallback 遠端」。
- 或維持遠端議程來源，但增加本機影片覆寫表（依場次 key 合併 `video`）。

