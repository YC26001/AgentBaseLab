import { AgentWorkspace } from "@/components/AgentWorkspace";

export default function Home() {
  return (
    <main className="app-shell">
      <header className="project-header">
        <p className="eyebrow">AI Agent · Repository 分析</p>
        <h1>AgentBaseLab</h1>
        <p className="project-description">
          觀察 Agent 如何探索 Repository、呼叫工具，並根據每一輪的觀察結果決定下一步。
        </p>
      </header>
      <AgentWorkspace />
    </main>
  );
}
