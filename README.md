# AgentBaseLab-Core

AgentBaseLab-Core 是一個為理解 AI Agent 核心機制而自行實作的 Learning Project。
目前提供 CLI，讓使用者提出 repository analysis 問題，由本機 Model 自行選擇工具、
讀取測試專案，並根據取得的資料回答。

專案自行實作 Model integration、Agent Loop、Tool Calling、Context / Message History、
Tool Result 回填、Tool Dispatch 與 Iteration Limit，沒有使用 LangChain Agent、
Claude Agent SDK 等會封裝核心 Agent Loop 的 framework。

## 架構

```text
User（CLI 問題）
 ↓
Agent Loop
 ↓
Ollama
 ↓
AgentAction（JSON）
 ├─ final → CLI 顯示最終回答
 └─ tool
      ↓
   Tool Dispatcher
      ↓
   list_files / read_file
      ↓
   Observation
      ↓
   回填 Message History，回到 Agent Loop
```

每輪的 Tool 名稱與路徑都由 Model 根據問題和前面的 Observation 決定。
程式負責解析 action、執行對應工具並保留對話，沒有預設固定的讀檔順序。

## 目前功能

- **Model integration**：使用 Node.js 內建 `fetch` 呼叫 Ollama Chat API，啟用 `think: true`、`stream: true`，逐筆處理 NDJSON；完整 content 只在 `done: true` 後解析成 AgentAction。
- **AgentAction**：使用 JSON action protocol，並在 runtime 檢查 type、Tool 名稱與必要欄位。
- **Tool Calling / Tool Dispatch**：依 Model action 執行 `list_files` 或 `read_file`。
- **Context / Message History**：保留問題、Model action 與 Tool Result，供下一輪 Model 使用。
- **檔案工具**：列出目錄中的名稱與 file / directory 類型，或讀取 UTF-8 文字檔案。
- **Workspace Boundary**：拒絕 absolute path、越界相對路徑與指向 workspace 外的 symlink。
- **大小限制**：`read_file` 最多 64 KiB；`list_files` 最多 200 entries；Tool Result 最多 64 KiB，超限直接拒絕。
- **Structured Execution Trace**：Core 回傳 `{ answer, trace }`，保存每輪 thinking、Tool 成敗、完整且受既有大小限制保護的 Structured Observation 與錯誤；CLI 負責顯示簡短摘要。
- **Execution Events**：透過 callback 即時提供 iteration、thinking delta、Tool 開始／成功完成、完整 final answer 與有限資訊的 error；content JSON 不對外逐段提供。
- **Iteration Limit**：最多 8 輪 Model 呼叫，超過限制時停止並報錯。
- **CLI**：接受 command line 問題，顯示簡短 action sequence 與最終回答；失敗時回傳非零 exit code。

## 技術

- Node.js 24
- TypeScript、tsx、ESM
- Ollama
- gemma4:12b

## 執行方式

必要前提：

- 已安裝 Node.js 24 與 npm；目前使用 Node.js v24.21.0 驗證。
- 已安裝並啟動 Ollama，服務可透過 `http://localhost:11434` 存取。
- 本機已具備 `gemma4:12b`，可使用 `ollama list` 確認。

從 AgentBaseLab-Core 根目錄執行：

```bash
npm install
npm run typecheck
npm test
npm run agent -- "分析這個專案主要在做什麼"
```

也可以提出不同問題：

```bash
npm run agent -- "這個專案實際會輸出什麼內容？"
```

`npm run agent` 使用 `tsx` 執行 `src/index.ts`；`npm run typecheck` 使用
`tsc --noEmit` 檢查型別，不產生 JavaScript 檔案。

沒有提供問題時，CLI 顯示用法並以 exit code 1 結束。

## Phase 5A Core 介面

既有 `runAgent(userInput, onTrace?)` 保持可用；第三個參數可接收即時 events：

```ts
import { runAgent } from "./src/agent/agent.js";
import type { AgentExecutionEvent } from "./src/agent/events.js";

const onEvent = (event: AgentExecutionEvent): void => {
  // Consumer 依 event.type 更新執行狀態。
};
const result = await runAgent("分析這個專案", undefined, onEvent);
// result.answer：完整回答；result.trace：本次執行的記憶體 trace。
```

| Event | 時機 |
| --- | --- |
| `iteration_started` | 每輪 Model request 前 |
| `model_thinking_delta` | 收到非空 thinking chunk 時，提供該輪 iteration 與 delta |
| `tool_started` | 完整 Model content 成功解析後、真正執行 Tool 前 |
| `tool_completed` | Tool 成功後，提供 input 與 Structured Observation |
| `final` | 完成解析 final action 後，一次提供完整 answer |
| `error` | Model、action、Tool 或 iteration limit 失敗後，提供 layer 與安全的顯示訊息 |

`callModel()` 現在回傳 `{ content, thinking, thinkingTruncated }`。
thinking 在串流累積時即限制為每輪 16,000 個 JavaScript string characters；
超限設 `thinkingTruncated: true`，後續 delta 仍即時提供，Core 不保存 delta history。
Tool／final／action error trace 保存該輪 thinking，stream 中斷時也保留受限的 partial thinking。
CLI 不印出完整 thinking。Ollama 傳輸格式參考其 [Streaming 文件](https://docs.ollama.com/api/streaming)。

Structured Observation 由同一次 Tool 執行結果建立，與給 Model 的原始 feedback 分開：

- `list_files`：`{ type, path, count, entries: [{ name, type }] }`。
- `read_file`：`{ type, path, bytes, lines, content }`；bytes 為回傳文字的 UTF-8 byte 數，lines 支援 LF／CRLF／CR，空文字為 0，結尾換行不額外計一行。

Observation 不另外截成 excerpt，仍受 64 KiB file／Tool Result 與 200 entries 上限保護。
Model message history 與 `OBSERVATION` feedback 格式維持原行為。
Tool 失敗時送出 `tool_started → error`，保留 failure trace 並拋出 `AgentExecutionError`；
不送 `tool_completed`、不回填錯誤讓 Model recovery，也不重試。
一般 error event 不包含 raw Model JSON、檔案內容或詳細 diagnostics；
技術錯誤沿用 bounded diagnostics，由 Core `console.error()` 與 Error／trace 保留。

## Demo 範例

以下是一種可能的流程，實際 Tool 順序、輪數與回答文字由 Model 決定：

```text
[1] tool: list_files path="." success
[2] tool: read_file path="README.md" success
[3] tool: list_files path="src" success
[4] tool: read_file path="src/index.ts" success
[5] tool: read_file path="package.json" success
[6] final

=== 最終回答 ===

這個測試專案定義了 greet 函式，執行時會印出 Hello, Agent!。
```

`example-repo/` 是供 Agent 分析的測試 repository，沒有額外安裝 dependencies。
它的 README 只介紹背景，實際行為需從原始碼確認。

## 目前限制

- 目前是 Learning MVP，workspace 固定為 `./example-repo`。
- Tool 只有 `list_files` 與 `read_file`。
- 已具備基本 path traversal 與 symlink escape 防護，仍不是 production sandbox，未隔離並行 filesystem 變更。
- Model output 使用 JSON action protocol；Tool Result 暫以標記為 Observation 的 `user` message 回填。
- content 是 AgentAction JSON protocol，累積完整後才解析；沒有 `model_content_delta`、`model_completed` 或 final answer token streaming。Model 或 Tool 出錯時直接停止。
- Structured Execution Trace 儲存在單次執行的記憶體中；成功時回傳，失敗時保留在錯誤物件的 `trace`，不寫入檔案。
- 本機 Ollama 推論速度依硬體與模型而異。
- Phase 5A 僅提供 Core execution data；尚未建立 HTTP API、Web UI 或 persistence。
