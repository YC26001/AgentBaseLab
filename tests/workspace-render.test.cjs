/* eslint-disable @typescript-eslint/no-require-imports -- Node tests intentionally use CommonJS. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// CSS class names are irrelevant to these semantic rendering assertions.
require.extensions[".css"] = module => { module.exports = {}; };
const { LiveAgentWorkspace } = require("../src/components/LiveAgentWorkspace.tsx");
const { AgentWorkspace } = require("../src/components/AgentWorkspace.tsx");
const { QuestionForm } = require("../src/components/QuestionForm.tsx");
const { ThinkingPanel } = require("../src/components/ThinkingPanel.tsx");
const { applyCoreEvent, createRunningRun } = require("../src/agent/run-state.ts");
const render = props => renderToStaticMarkup(React.createElement(AgentWorkspace, props));

test("live initial UI is ready for input with no trace/result or integration-pending message", () => {
  const html = renderToStaticMarkup(React.createElement(LiveAgentWorkspace));
  assert(html.includes("執行 Agent"));
  assert(!html.includes("目前尚未開放即時執行"));
  assert(!html.includes("執行軌跡"));
  assert(!html.includes("最終回答"));
  assert(!html.includes("錯誤結果"));
  assert(html.includes('placeholder="輸入你想了解的問題，Agent 會使用唯讀工具分析固定的示範 Repository"'));
  assert(!html.includes("從一個問題開始"));
  assert(!html.includes("Agent 會使用唯讀工具分析固定的示範 Repository。"));
  assert(!html.includes('role="status"'));
  assert(!html.includes("aria-describedby"), "idle form must not reference a removed help element");
});

test("form status messages remain available after removing idle help", () => {
  for (const [props, message] of [
    [{ availability: "ready", submitting: true }, "正在連線 Agent Core…"],
    [{ availability: "ready", running: true }, "Agent 執行中，可在下方查看執行軌跡。"],
    [{ availability: "busy" }, "Agent 忙碌中，請等候目前的執行結束。"],
    [{ availability: "pending" }, "目前尚未開放即時執行，你可以先準備問題。"],
  ]) {
    const html = renderToStaticMarkup(React.createElement(QuestionForm, {
      running: false, onRun() {}, ...props,
    }));
    assert(html.includes(message));
    assert(html.includes('role="status"'));
    const helpId = html.match(/<p id="([^"]+)"[^>]*role="status"/)[1];
    assert(html.includes(`aria-describedby="${helpId}"`));
  }
});

test("decision loading dots exist only while generating and stay hidden from assistive technology", () => {
  const loading = renderToStaticMarkup(React.createElement(ThinkingPanel, { generating: true }));
  assert(loading.includes("正在產生決策"));
  assert.match(loading, /<span[^>]*aria-hidden="true"><span>\.<\/span><span>\.<\/span><span>\.<\/span><\/span>/);
  assert(loading.includes("<span>...</span>"), "screen readers receive stable, non-animated punctuation");
  assert.equal(renderToStaticMarkup(React.createElement(ThinkingPanel, { generating: false })), "");
  const completed = renderToStaticMarkup(React.createElement(ThinkingPanel, {
    generating: false, thinking: { text: "已收到的推論" },
  }));
  assert(completed.includes("已收到的推論"));
  assert(!completed.includes("正在產生決策"));
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
