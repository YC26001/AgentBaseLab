/* eslint-disable @typescript-eslint/no-require-imports -- Node tests intentionally use CommonJS. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getAgentRunUrl } = require("../src/agent/config.ts");
const { consumeCoreStream, CoreHttpError, runAgentRequest } = require("../src/agent/core-client.ts");
const { parseCoreEvent } = require("../src/agent/core-events.ts");
const { applyCoreEvent, createRunningRun, failRunTransport } = require("../src/agent/run-state.ts");

// Protocol records are test inputs only; no mock Agent, endpoint, or event player.
const started = { type: "iteration_started", iteration: 1 };
const final = { type: "final", iteration: 1, answer: "繁體中文回答 🧪" };
const encode = (events) => new TextEncoder().encode(events.map(JSON.stringify).join("\n") + "\n");
const streamOf = (chunks) => new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  },
});

test("URL is centralized, accepts HTTPS and normalizes trailing slashes", () => {
  const original = process.env.NEXT_PUBLIC_AGENT_CORE_BASE_URL;
  try {
    delete process.env.NEXT_PUBLIC_AGENT_CORE_BASE_URL;
    assert.equal(getAgentRunUrl(), "http://127.0.0.1:3001/api/agent/run");
    process.env.NEXT_PUBLIC_AGENT_CORE_BASE_URL = "https://agent.example.com/";
    assert.equal(getAgentRunUrl(), "https://agent.example.com/api/agent/run");
    process.env.NEXT_PUBLIC_AGENT_CORE_BASE_URL = "not-a-url";
    assert.throws(getAgentRunUrl);
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_AGENT_CORE_BASE_URL;
    else process.env.NEXT_PUBLIC_AGENT_CORE_BASE_URL = original;
  }
});

test("NDJSON works at every byte split, including multibyte UTF-8 and multiple records", async () => {
  const records = [started, { type: "model_thinking_delta", iteration: 1, delta: "分析中 🧪" }, final];
  const bytes = encode(records);
  for (let at = 1; at < bytes.length; at++) {
    const received = [];
    await consumeCoreStream(streamOf([bytes.slice(0, at), bytes.slice(at)]), event => received.push(event));
    assert.deepEqual(received, records, `byte split ${at}`);
  }
  const received = [];
  await consumeCoreStream(streamOf(Array.from(bytes, byte => Uint8Array.of(byte))), event => received.push(event));
  assert.deepEqual(received, records);
});

test("terminal events complete without waiting for EOF or an invented done event", async () => {
  let cancelled = false;
  const source = new ReadableStream({
    start(controller) { controller.enqueue(encode([started, final])); },
    cancel() { cancelled = true; },
  });
  const received = [];
  await consumeCoreStream(source, event => received.push(event));
  assert.deepEqual(received, [started, final]);
  assert(cancelled);
});

test("CRLF/blank lines are handled; malformed, truncated, invalid UTF-8, or missing-terminal streams fail", async () => {
  const received = [];
  const bytes = new TextEncoder().encode(`\r\n${JSON.stringify(started)}\r\n${JSON.stringify(final)}\r\n`);
  await consumeCoreStream(streamOf([bytes]), event => received.push(event));
  assert.deepEqual(received, [started, final]);
  for (const text of ["{invalid}\n", JSON.stringify(final), JSON.stringify(started) + "\n", ""]) {
    await assert.rejects(consumeCoreStream(streamOf([new TextEncoder().encode(text)]), () => {}));
  }
  await assert.rejects(consumeCoreStream(streamOf([Uint8Array.of(0xff)]), () => {}));
  await assert.rejects(consumeCoreStream(streamOf([new TextEncoder().encode("x".repeat(1024 * 1024 + 1))]), () => {}));
});

test("only formal Core event shapes are accepted", () => {
  for (const type of ["done", "stream_completed", "recovered", "model_completed", "model_content_delta"]) {
    assert.throws(() => parseCoreEvent({ type, iteration: 1 }));
  }
  assert.throws(() => parseCoreEvent({ type: "error", layer: "tool", error: "Failure" }));
  assert.throws(() => parseCoreEvent({ type: "final", iteration: 1, answer: " " }));
  assert.throws(() => parseCoreEvent({
    type: "tool_completed", iteration: 1, tool: "read_file", input: { path: "README.md" },
    observation: { type: "read_file", path: "README.md", bytes: "12", lines: 1, content: "text" },
  }));
});

function toolStarted(iteration, path, tool = "read_file") {
  return { type: "tool_started", iteration, tool, input: { path } };
}
function fileCompleted(iteration, path) {
  return {
    type: "tool_completed", iteration, tool: "read_file", input: { path },
    observation: { type: "read_file", path, bytes: 4, lines: 1, content: "text" },
  };
}

test("adapter accumulates bounded thinking, maps real tool lifecycle and deduplicates inspected files", () => {
  let run = createRunningRun("run-1", "問題");
  run = applyCoreEvent(run, started);
  const initialIteration = run.iterations[0];
  run = applyCoreEvent(run, { type: "model_thinking_delta", iteration: 1, delta: "先" });
  run = applyCoreEvent(run, { type: "model_thinking_delta", iteration: 1, delta: "讀檔" });
  assert.equal(run.iterations[0].thinking.text, "先讀檔");
  assert.equal(initialIteration.thinking, undefined, "old props must remain immutable");
  run = applyCoreEvent(run, { type: "model_thinking_delta", iteration: 1, delta: "x".repeat(16000) });
  assert.equal(run.iterations[0].thinking.text.length, 16000);
  assert.equal(run.iterations[0].thinking.truncated, true);
  run = applyCoreEvent(run, toolStarted(1, "README.md"));
  assert.equal(run.iterations[0].toolCall.status, "running");
  assert.equal(run.iterations[0].observation, undefined);
  run = applyCoreEvent(run, fileCompleted(1, "README.md"));
  assert.equal(run.iterations[0].toolCall.status, "success");
  assert.equal(run.iterations[0].observation.excerpt, "text");
  run = applyCoreEvent(run, { type: "iteration_started", iteration: 2 });
  assert.equal(run.iterations[0].handoff, undefined, "do not predict the next action");
  run = applyCoreEvent(run, toolStarted(2, "README.md"));
  assert.equal(run.iterations[0].handoff, "next-tool");
  run = applyCoreEvent(run, fileCompleted(2, "README.md"));
  run = applyCoreEvent(run, { type: "iteration_started", iteration: 3 });
  run = applyCoreEvent(run, { ...final, iteration: 3 });
  assert.equal(run.status, "success");
  assert.deepEqual(run.result.filesInspected, ["README.md"]);
  assert.equal(run.iterations[1].handoff, "final");
  assert.equal(run.result.answer, final.answer);
  const next = createRunningRun("run-2", "新問題");
  assert.deepEqual(next.iterations, []);
  assert.equal(next.result, undefined);
  assert.equal(applyCoreEvent(run, started), run, "terminal runs cannot be changed by late events");
});

test("list_files observations map to the existing listing UI", () => {
  let run = applyCoreEvent(createRunningRun("run", "問題"), started);
  run = applyCoreEvent(run, toolStarted(1, ".", "list_files"));
  run = applyCoreEvent(run, {
    type: "tool_completed", iteration: 1, tool: "list_files", input: { path: "." },
    observation: { type: "list_files", path: ".", count: 1, entries: [{ name: "src", type: "directory" }] },
  });
  assert.deepEqual(run.iterations[0].observation, {
    kind: "list_files", count: 1, entries: [{ name: "src", type: "directory" }],
  });
  run = applyCoreEvent(run, { type: "iteration_started", iteration: 2 });
  run = applyCoreEvent(run, { ...final, iteration: 2 });
  assert.deepEqual(run.result.filesInspected, [], "directory listing is not file inspection");
});

test("tool_started → error fails the tool and yields only an Error Result", () => {
  let run = applyCoreEvent(createRunningRun("run", "問題"), started);
  run = applyCoreEvent(run, toolStarted(1, "missing.txt"));
  run = applyCoreEvent(run, { type: "error", iteration: 1, layer: "tool", error: "Tool read_file failed. Run terminated." });
  assert.equal(run.status, "error");
  assert.equal(run.iterations[0].toolCall.status, "error");
  assert.equal(run.iterations[0].observation, undefined);
  assert.equal(run.result.kind, "error");
  assert.equal(run.result.answer, undefined);
  assert.equal(run.iterations[0].handoff, undefined);
});

test("transport failure preserves observed tool status and does not claim Core terminated", () => {
  let run = applyCoreEvent(createRunningRun("run", "問題"), started);
  run = applyCoreEvent(run, toolStarted(1, "README.md"));
  run = failRunTransport(run, "串流中斷");
  assert.equal(run.status, "error");
  assert.equal(run.result.heading, "無法確認執行結果");
  assert.equal(run.iterations[0].toolCall.status, "running");
  assert.equal(run.iterations[0].observation, undefined);
});

test("HTTP 400/409 are classified before accepting execution; POST uses the central URL", async () => {
  const originalFetch = global.fetch;
  try {
    for (const status of [400, 409]) {
      let accepted = false;
      let received = false;
      global.fetch = async (url, options) => {
        assert.equal(url, getAgentRunUrl());
        assert.equal(options.method, "POST");
        assert.deepEqual(JSON.parse(options.body), { question: "問題" });
        return new Response(JSON.stringify({ error: { code: status === 400 ? "INVALID_REQUEST" : "AGENT_BUSY", message: "Rejected" } }), {
          status, headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      };
      await assert.rejects(runAgentRequest({
        question: "問題", signal: new AbortController().signal,
        onAccepted() { accepted = true; }, onEvent() { received = true; },
      }), error => error instanceof CoreHttpError && error.status === status);
      assert.equal(accepted, false);
      assert.equal(received, false);
    }
  } finally { global.fetch = originalFetch; }
});
