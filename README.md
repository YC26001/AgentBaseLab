# AgentBaseLab

AgentBaseLab 是一個用來理解 AI Agent 核心機制的 Learning Project，包含核心 API 與 Web 介面。
使用者可透過網頁提出 repository analysis 問題，由 Ollama 上的 `gemma4:12b` 選擇檔案工具，
讀取測試專案並回答；Web 會即時顯示 Thinking、Tool Calls、Observation 與最終結果。

## 專案結構

```text
AgentBaseLab/
├── core/    # Agent runtime、檔案工具、Ollama integration、HTTP API
└── web/     # Next.js、React、NDJSON 串流介面
```

Core 與 Web 各自管理 dependencies、啟動指令及測試。
Core 使用 Node.js 內建 HTTP API 提供 NDJSON execution events；Web 在瀏覽器直接呼叫 Core。

## 環境需求

- Node.js 24 與 npm。
- Ollama，可透過 `http://localhost:11434` 存取。
- `gemma4:12b` 模型。

啟動 Ollama 後，可用以下指令下載模型：

```bash
ollama pull gemma4:12b
```

## 本機開發

從專案根目錄，在第一個 terminal 啟動 Core：

```bash
cd core
npm ci
npm run api
```

在第二個 terminal 啟動 Web：

```bash
cd web
npm ci
npm run dev
```

開啟 http://localhost:3000。

Core 預設監聽 `127.0.0.1:3001`，Ollama 預設使用 `localhost:11434`。
Web 未設定 `NEXT_PUBLIC_AGENT_CORE_BASE_URL` 時，使用 `http://127.0.0.1:3001`。
若需要調整 Web 的 API 位址，可將 `web/.env.example` 複製為 `web/.env.local` 後修改。
Core 的 `WEB_ORIGIN` 必須與瀏覽器開啟 Web 的完整 origin 相同，預設為 `http://localhost:3000`。

Core 的分析 workspace 是 `core/example-repo/`，啟動 API 或 CLI 時應以 `core/` 作為工作目錄。
也可以在 `core/` 使用 CLI：

```bash
npm run agent -- "分析這個專案主要在做什麼"
```

## 驗證

在 `core/` 執行：

```bash
npm run typecheck
npm test
```

在 `web/` 執行：

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

詳細 API contract、Agent 行為與前端互動請參閱 [Core README](core/README.md) 與 [Web README](web/README.md)。
