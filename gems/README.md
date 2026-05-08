# GEMS 加密貨幣信號機器人

本專案包含：
- 交易信號掃描機器人
- 信號評分與勝率統計流程
- 可遠端查詢的統計儀表板資料輸出

## 主要文件
- 信號評分與勝率規則：
  - [docs/signal_scoring_and_winrate.md](/C:/Users/GGT/Documents/GitHub/gems/docs/signal_scoring_and_winrate.md)
- 機器人更新紀錄：
  - [BOT_CHANGELOG.md](/C:/Users/GGT/Documents/GitHub/gems/BOT_CHANGELOG.md)
- 專案結構說明：
  - [STRUCTURE.md](/C:/Users/GGT/Documents/GitHub/gems/STRUCTURE.md)

## 📚 系統文檔 (Documentation)

詳細的系統說明、評分邏輯與操作指南已整理至 `docs/` 資料夾：

- [**文檔中心首頁 (docs/README.md)**](./docs/README.md)
- [**訊號評分與達標標準**](./docs/signal_scoring_and_winrate.md)
- [**儀表板使用指南**](./docs/interface_guide.md)
- [**系統架構說明 (STRUCTURE.md)**](./STRUCTURE.md)

---

## 🚀 快速啟動 (Quick Start)
- 主程式：
  - `src/scripts/telegram_query_bot.js`
- Docker 服務名稱：
  - `gem0507`

## 信號統計資料
- 執行時統計檔：
  - `data/signal_journal.json`
- 儀表板公開鏡像檔：
  - `public/api/signal_journal.json`

## 儀表板
- 靜態儀表板頁面：
  - `public/signal_dashboard.html`
