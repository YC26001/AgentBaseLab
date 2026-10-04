# AgentBaseLab

AgentBaseLab 是一個用來理解 AI Agent 核心機制的 Learning Project，包含核心 API 與 Web 介面。
使用者可透過網頁提出 repository analysis 問題，由 Ollama 上的 `gemma4:12b` 選擇檔案工具，
讀取測試專案並回答；Web 會即時顯示 Thinking、Tool Calls、Observation 與最終結果。

## 專案結構

```text
AgentBaseLab/
├── core/             # Agent runtime、檔案工具、Ollama integration、HTTP API
├── web/              # Next.js、React、NDJSON 串流介面
├── compose.yaml      # 從 source 建置並啟動整套服務
└── compose.gpu.yaml  # NVIDIA GPU 選配
```

Core 與 Web 各自管理 dependencies、啟動指令及測試。
Core 使用 Node.js 內建 HTTP API 提供 NDJSON execution events；Web 在瀏覽器直接呼叫 Core。

## Docker Compose

需要 Docker Engine／Docker Desktop 與 Docker Compose。Core 與 Web 會依各自的 Dockerfile
從本機 source 建置 image，不需要將專案 image 上傳至 registry，也不需要在主機安裝 Node.js 或 Ollama。
首次啟動需要網路下載 Node／Ollama 的官方 image、npm dependencies 與模型。

從專案根目錄執行：

```bash
docker compose up -d --build
```

啟動順序為 Ollama 就緒 → `ollama-init` 確認／下載 `gemma4:12b` → Core 健康檢查通過 → Web。
首次下載模型可能需要數分鐘；`ollama-init` 完成後顯示 `Exited (0)` 是正常狀態。
開啟 http://localhost:3000，Core 位址為 http://localhost:3001。

可在另一個 terminal 檢查進度與服務狀態：

```bash
docker compose logs -f ollama-init
docker compose ps -a
docker compose logs -f core web
```

模型儲存在 `ollama-data` named volume；重新建立容器時會使用已下載的模型。
Ollama 只供容器內部使用，不占用主機的 11434 port。Web 與 Core 預設只公開在主機的 loopback 位址。
Agent 分析的 `example-repo` 已包含於 Core image 中。

修改程式碼後重新執行 `docker compose up -d --build`，即可重新建置並更新服務。
停止服務並保留模型：

```bash
docker compose down
```

若也要刪除模型資料，可使用 `docker compose down -v`；下次啟動會重新下載模型。

### 設定網址、port 與模型

預設不需要 `.env`。需要調整時，可將根目錄 `.env.example` 複製成 `.env`：

```bash
cp .env.example .env
```

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `APP_HOST` | `localhost` | 瀏覽器可存取的主機名稱或 IP，不包含 scheme／port |
| `WEB_PORT` | `3000` | 主機上的 Web port |
| `CORE_PORT` | `3001` | 主機上的 Core port |
| `BIND_ADDRESS` | `127.0.0.1` | 主機公開服務的介面 |
| `OLLAMA_MODEL` | `gemma4:12b` | Core 與模型初始化共同使用的模型名稱 |
| `OLLAMA_IMAGE` | `ollama/ollama:latest` | Ollama 官方 image，可指定版本 tag |

例如從同一區網的其他電腦使用，將 `APP_HOST` 設為 Docker 主機的 IP、
`BIND_ADDRESS` 設為 `0.0.0.0`，再重新建置。瀏覽器應使用 `http://<APP_HOST>:<WEB_PORT>` 開啟 Web。
Compose 會同步設定 Core 的 CORS origin 與 Web 的 API 位址。
Web 的 API 位址會寫入 browser bundle，因此變更 `APP_HOST` 或 `CORE_PORT` 後必須重新 build。
目前 Compose 的 browser URL 使用 HTTP。

### NVIDIA GPU

預設使用 CPU。若 Docker 主機已配置 NVIDIA driver 與
[NVIDIA Container Toolkit](https://docs.ollama.com/docker)，可使用 GPU 設定：

```bash
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

使用 GPU 設定啟動後，後續 Compose 管理指令也應帶上相同的兩個 `-f` 參數。

### 確認服務正常

啟動完成後執行：

```bash
docker compose ps -a
curl -fsS http://localhost:3001/health
docker compose exec ollama ollama list
```

`ollama`、`core`、`web` 應為 healthy，`ollama-init` 應為 `Exited (0)`。
health endpoint 應回傳 `{"status":"ok"}`，模型清單應包含 `gemma4:12b`。
再開啟 http://localhost:3000，提交「分析這個專案主要在做什麼」，確認執行軌跡逐步更新並出現最終回答。
若執行失敗，可用 `docker compose logs --tail=100 ollama-init ollama core web` 查看原因。

## 本機開發環境需求

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
