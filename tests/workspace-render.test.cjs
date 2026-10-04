/* eslint-disable @typescript-eslint/no-require-imports -- Node tests intentionally use CommonJS. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// CSS class names are irrelevant to these semantic rendering assertions.
require.extensions[".css"] = module => { module.exports = {}; };
const { LiveAgentWorkspace } = require("../src/components/LiveAgentWorkspace.tsx");
const { AgentWorkspace } = require("../src/components/AgentWorkspace.tsx");
const { applyCoreEvent, createRunningRun } = require("../src/agent/run-state.ts");
const render = props => renderToStaticMarkup(React.createElement(AgentWorkspace, props));

test("live initial UI is ready for input with no trace/result or integration-pending message", () => {
  const html = renderToStaticMarkup(React.createElement(LiveAgentWorkspace));
  assert(html.includes("執行 Agent"));
  assert(!html.includes("目前尚未開放即時執行"));
  assert(!html.includes("執行軌跡"));
  assert(!html.includes("最終回答"));
  assert(!html.includes("錯誤結果"));
});

test("HTTP rejection notices stay in the question area without an execution group", () => {
  for (const notice of ["請求無效：question must be a non-empty string.", "Agent 正在執行其他請求，請稍後再試。"]) {
    const html = render({ run: { status: "idle" }, availability: "ready", notice });
    assert(html.includes(notice));
    assert(!html.includes("執行輪次"));
    assert(!html.includes("錯誤結果"));
  }
});

test("actual view updates preserve disclosure defaults and terminal results outside the trace", () => {
  let run = createRunningRun("run", "問題");
  for (const event of [
    { type: "iteration_started", iteration: 1 },
    { type: "model_thinking_delta", iteration: 1, delta: "模型提供的推論" },
    { type: "tool_started", iteration: 1, tool: "read_file", input: { path: "README.md" } },
    {
      type: "tool_completed", iteration: 1, tool: "read_file", input: { path: "README.md" },
      observation: { type: "read_file", path: "README.md", bytes: 12, lines: 1, content: "<script>text</script>" },
    },
  ]) run = applyCoreEvent(run, event);
  const reading = render({ run });
  assert(reading.includes("模型提供的推論"));
  assert(reading.includes('&lt;script&gt;text&lt;/script&gt;'));
  assert.match(reading, /aria-expanded="true"/);
  assert.match(reading, /aria-expanded="false"/);
  assert(reading.indexOf("查看模型推論") < reading.indexOf("工具呼叫"));
  assert(!reading.includes("最終回答"));

  // Iteration-limit errors can follow a successful tool in the same iteration.
  const failed = applyCoreEvent(run, { type: "error", iteration: 1, layer: "iteration_limit", error: "Limit reached" });
  const html = render({ run: failed });
  assert(html.includes("讀取成功"), "successful observation must remain visible");
  assert(html.includes("錯誤結果"));
  assert(html.includes("執行已終止"));
  assert(!html.includes("最終回答"));
  assert.match(html, /<\/section><section[^>]*><p[^>]*>執行結果/, "result must be outside the trace section");
});
