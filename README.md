# AgentBaseLab-Web

AgentBaseLab 的獨立 Web frontend repository，使用 Next.js、React、TypeScript、App Router、npm 與 ESLint。

單頁、單欄的繁體中文 Web UI，透過 AgentBaseLab-Core Phase 5B 的 HTTP API / NDJSON Execution Events 執行真正的 Repository 分析。Agent runtime、Ollama 與 tools 留在獨立的 Core repository。端到端驗證需要本機 Core 與 Ollama。

## 開發

```bash
npm install
npm run dev
```

在另一個 terminal 啟動已完成 Phase 5B 的 AgentBaseLab-Core（於 Core repository 執行 `npm run api`），並確認 Ollama 可用。Web 開啟 http://localhost:3000。首頁位於 `src/app/page.tsx`，`@/*` 對應 `src/*`。

## Core URL 與 CORS

所有 Core request 經 `src/agent/config.ts` 集中組成 URL：

```dotenv
NEXT_PUBLIC_AGENT_CORE_BASE_URL=http://127.0.0.1:3001
```

可複製 `.env.example` 為 `.env.local`，修改 base URL；未設定時使用上述 local 預設值。固定 path 為 `/api/agent/run`。例如改成 `https://agent.example.com`，不需要修改 React source。

`NEXT_PUBLIC_` 值會進入 browser bundle：修改後需重啟 dev server，production 需重新 build。`.env.example` 可追蹤，`.env.local` 被忽略。

Browser 直接 POST Core，不經 Next.js backend。Core 的 `WEB_ORIGIN` 必須與 Web 的完整 origin 相同；Core 預設為 `http://localhost:3000`。若改用 `http://127.0.0.1:3000` 或其他 port，請在啟動 Core 時設定相應的 `WEB_ORIGIN`。本 Web repo 不修改 Core contract 或 CORS 規則。

## 驗證

```bash
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

## UI 與 Core integration boundary

初始頁面只有專案簡介、推薦問題、輸入框與「執行 Agent」。推薦問題只填入輸入框，不會自動執行。非空問題可送出；提交或執行期間禁止重複提交。沒有 mock Agent、假延遲或 Replay UI。

`LiveAgentWorkspace` 使用 `useAgentRun` 連接既有 `AgentWorkspace` props。`core-client.ts` POST `{ question }`，以 ReadableStream、streaming TextDecoder 與 pending buffer 按換行切出完整 records，才做 JSON parsing。Network chunk 不等於 event；跨 chunk UTF-8 也持續解碼。`core-events.ts` 鏡映並驗證正式 Core event shape，`run-state.ts` 轉成既有 view state。`view-types.ts` 仍只定義 presentation props。

只消費 `iteration_started`、`model_thinking_delta`、`tool_started`、`tool_completed`、`final`、`error`。收到 `final`／`error` 立即結束 UI Running，釋放 stream reader，不等待額外 done 或 EOF。EOF 缺少 terminal、無效 JSON／event、UTF-8 或網路中斷均視為 transport failure。

HTTP 400／409 在 execution 開始前顯示問題區提示，不建立 iteration 或 Agent Result。409 可稍後重新提交，不輪詢、不自行恢復。200 串流中的 `error` 是正式 Error Result；tool-layer error 把同輪 Running tool 標為 Error，不產生假的 Observation 或 Success。

連線中斷時顯示「無法確認執行結果」，保留已收到的 Trace，不假裝 Core 已終止；Core 可能仍在執行。離開頁面僅關閉 browser request，沒有提供 Core cancellation 或 Stop UI。

Final Answer 的已檢視檔案清單只來自本次 Run 成功完成的 `read_file`，依 path 去重；`final` event 不需要額外欄位。Thinking 每輪最多保留 16,000 字元並標示截短，不儲存 delta history。

新的提交立即清除上一輪 Trace／Result；HTTP 200 接受後，以新的 `id` 開始空 Run，只在真正收到 `iteration_started` 後建立 iteration。Thinking 與 Observation 預設收合，Trace 預設展開，Result 位於 Trace 外，不受 Trace 收合影響。Observation 顯示有上限的 excerpt，不解析給 Model 的原始 Tool Result。

頁面採 document scrolling。`useAutoFollow` 每次收到新的 view state 後，在 animation frame 跟隨 Trace 底部；使用者向上 wheel、touch、鍵盤或 scrollbar 捲動時暫停。回到最新位置附近或按「回到最新執行位置」可恢復；收合 Trace 與完成執行時停止跟隨。自動捲動不使用 smooth animation。

`npm test` 使用 Node 內建 test runner 與既有 TypeScript dependency，測試 protocol records、UTF-8／NDJSON 邊界、事件映射、錯誤分類與新 Run state。這些是隔離的 transport／adapter 回歸檢查，不是 Ollama 端到端驗證；沒有建立 mock Agent 或 mock API server。

## 正常 WSL 的手動驗證

1. 啟動 Ollama、Core API 與 Web；Core `WEB_ORIGIN` 與瀏覽器網址 origin 必須一致。
2. 選推薦問題，確認只填入輸入框；按「執行 Agent」後，Network 應顯示 POST `/api/agent/run`，200 `application/x-ndjson`。
3. 確認 Thinking 收合時仍接收內容，展開後逐步增加；Tool 顯示執行中 → 成功；兩種 Observation 可閱讀，excerpt 可展開。
4. Final Answer 出現、Running 結束，已檢視檔案只包含成功的 `read_file` 且不重複。Trace 維持展開。
5. 再執行另一題，確認上一輪 Trace／Result 立即清除，新一輪 disclosures 回到預設。
6. 執行期間往上捲動查看舊內容，確認新 event 不會把頁面拉回底部；回到最新位置附近或按回到最新位置按鈕後恢復跟隨。也檢查觸控、鍵盤與 excerpt 內部捲動。
7. 在第一個分頁執行中，用第二個分頁提交，確認 HTTP 409 顯示 busy 提示，沒有 iteration 或 Error Result；第一個 Run 完成後可重試。
8. 正式表單會阻擋空白提交。可在輸入框貼上超過 64 KiB 的問題（例如 12,000 次「測試」），提交後確認 400 `INVALID_REQUEST`，問題區顯示請求無效且沒有 iteration／Result。也可在 DevTools Console 以集中設定的 URL 送出 `{ "question": "" }`（例如 `fetch(new URL('/api/agent/run', '<你的 Core base URL>'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: '' }) })`）驗證 Core 的空白 request 拒絕。
9. 執行前停止 Ollama，送出問題，確認 Core model-layer `error` 顯示 Error Result，沒有 Final Answer；收合 Trace 後錯誤結果仍可見。恢復 Ollama 後再正常執行。
10. 若需驗證 tool failure，可提問「請讀取不存在的檔案 `__agentbaselab_missing_file__.txt` 並說明內容」，觀察真實 `read_file` 是否出現 `tool_started → error`、工具變為錯誤且沒有成功 Observation。Model 也可能先檢查目錄後直接回答檔案不存在，這不算 tool failure；不要用假 event 或修改 Core 強迫流程。單元測試另行涵蓋 failure 映射。
11. 可在串流期間中斷網路，確認顯示「無法確認執行結果」並保留 partial Trace，沒有假的成功或 recovery。Core 可能仍忙碌直到真實執行結束。
