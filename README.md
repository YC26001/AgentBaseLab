# AgentBaseLab-Web

AgentBaseLab 的獨立 Web frontend repository，使用 Next.js、React、TypeScript、App Router、npm 與 ESLint。

目前只有 foundation 與首頁 placeholder。Agent runtime、Ollama 與 tools 屬於獨立的 AgentBaseLab-Core repository；API / streaming integration 等待 Core contract 完成後再實作。

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

## 目前初始化狀態

已建立最小專案檔案，但本次環境無法解析 `registry.npmjs.org`，因此 dependencies 尚未安裝，尚無 `package-lock.json`，lint 與 production build 尚未通過。`package.json` 的版本是待安裝宣告，並非已安裝版本。

環境預置的 `.git` 是唯讀空目錄，`git init` 失敗，尚未建立有效 Git repository。需要在可連線 npm registry 且 `.git` 可寫的環境完成安裝、驗證與 Git 初始化。
