import { runAgent } from "./agent/agent.js";
import type { ExecutionTraceEntry } from "./agent/trace.js";
import { describeError, previewText } from "./diagnostics.js";

function displayTrace(entry: ExecutionTraceEntry): void {
  if (entry.type === "tool") {
    console.log(`[${entry.iteration}] tool: ${entry.tool} path=${JSON.stringify(previewText(entry.input.path))} ${entry.status}`);
  } else if (entry.type === "final") {
    console.log(`[${entry.iteration}] final`);
  } else {
    console.error(`[${entry.iteration}] error: ${entry.layer}`);
  }
}

const userInput = process.argv.slice(2).join(" ").trim();

if (!userInput) {
  console.error('用法：npm run agent -- "你的 repository analysis 問題"');
  process.exitCode = 1;
} else {
  try {
    const result = await runAgent(userInput, displayTrace);
    console.log("\n=== 最終回答 ===\n");
    console.log(result.answer);
  } catch (error) {
    console.error("Agent 執行失敗：", describeError(error));
    if (error instanceof Error && error.cause instanceof Error) {
      console.error("原因：", describeError(error.cause));
    }
    process.exitCode = 1;
  }
}
