# AgentBaseLab-Web

AgentBaseLab 的獨立 Web frontend repository，使用 Next.js、React、TypeScript、App Router、npm 與 ESLint。

Web UI implementation in progress。已建立單頁、單欄的 Question、Execution Trace 與 Result components。AgentBaseLab-Core integration pending：Agent runtime、Ollama 與 tools 屬於獨立的 Core repository，尚未串接 API 或 streaming。

## 開發

```bash
npm install
npm run dev
```

開啟 http://localhost:3000。首頁位於 `src/app/page.tsx`，`@/*` 對應 `src/*`。

## 驗證

```bash
npm run lint
npm run build
```

## UI 與 Core integration boundary

初始頁面只有專案簡介、推薦問題、輸入框與停用的 `Run Agent`。推薦問題只填入輸入框，不會自動執行。沒有 mock Agent、假延遲或 Replay UI。

`src/components/AgentWorkspace.tsx` 接收顯示用 `run`、`availability` 與 `onRun` props。未來真正 Core client 應負責接收正式 events、更新單次 run 的 UI state，再交給 components rendering。`view-types.ts` 只定義 presentation props，不是正式 API 或 streaming contract。

新 run 必須使用新的 `id`，立即取代上一輪 iterations 與 result；各 disclosure 的 state 會隨新 run 重設。Thinking 與 Observation 預設收合，Trace 預設展開，Result 位於 Trace 外，不受 Trace 收合影響。Observation 顯示有上限的 excerpt，不解析給 Model 的原始 Tool Result。

本輪沒有 transport、production event parser 或 runtime state transitions。Thinking streaming、tool lifecycle、auto-follow、新 run reset 與真實 Final Answer / Error 的流程，需要 Core integration 後用真實 execution 驗證。頁面採 document scrolling，Trace 保留 latest-execution anchor，供後續 auto-follow 使用。
