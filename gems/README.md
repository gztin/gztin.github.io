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

## 執行與部署
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
