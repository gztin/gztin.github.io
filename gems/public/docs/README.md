# Gems 系統文檔中心

歡迎來到 Gems 訊號情報系統的開發與運作說明中心。

## 📖 目錄

### 1. 系統架構與設計
- [**訊號評分與達標評估**](signal_scoring_and_winrate.md)
  詳細說明 0-100 評分模型、四段式追蹤推送邏輯以及達標漲幅門檻。

- [**儀表板使用說明**](interface_guide.md)
  介紹前端監控介面、過濾機制與主題切換功能。

- [**系統整體結構 (STRUCTURE.md)**](STRUCTURE.md)
  核心程式碼目錄架構、Docker 部署以及各 Loop 循環的邏輯職責。

---

## 🚀 快速開始
1. **啟動監控**：`npm run dev` 或 `docker-compose up -d`
2. **查看日誌**：`tail -f bot_log.txt`
3. **訪問儀表板**：開啟 `public/signal_dashboard.html`
