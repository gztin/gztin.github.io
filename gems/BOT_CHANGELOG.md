# Bot Changelog

此文件專為 Telegram Bot 的 `/VERSION` 指令設計，提供精簡版的改版摘要。

---

## [v2.24.3] - 2026-04-26
### 改版資訊自動化

- 新增 release:update 腳本，自動重寫 BOT_CHANGELOG.md 並只保留最新版本。
- 腳本會驗證版本格式、日期格式與條列數，避免超過 10 點。
- 自動化流程會先執行 git diff --cached --check，再 commit 與 push。
- workflow 規範新增「更新改版資訊」觸發語，明確禁止把 runtime data 與回測結果一起提交。
