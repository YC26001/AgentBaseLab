import { runAgent } from "./agent/agent.js";

const userInput = process.argv.slice(2).join(" ").trim();

if (!userInput) {
  console.error('用法：npm run agent -- "你的 repository analysis 問題"');
  process.exitCode = 1;
} else {
  try {
    const answer = await runAgent(userInput);
    console.log("\n=== 最終回答 ===\n");
    console.log(answer);
  } catch (error) {
    console.error("Agent 執行失敗：", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.cause instanceof Error) {
      console.error("原因：", error.cause.message);
    }
    process.exitCode = 1;
  }
}
