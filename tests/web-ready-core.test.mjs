import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { callModel, ModelStreamError } from "../src/model/ollama.ts";
import { runAgent } from "../src/agent/agent.ts";
import { AgentExecutionError } from "../src/agent/trace.ts";
import { MAX_THINKING_CHARS, MAX_READ_FILE_BYTES, MAX_LIST_ENTRIES } from "../src/limits.ts";

const encoder = new TextEncoder();
const final = { type: "final", answer: "完整回答：中文 🙂" };
const tool = (name, filePath) => ({ type: "tool", tool: name, input: { path: filePath } });
const chunk = (message, done = false) => ({ message, done });
const line = (record) => JSON.stringify(record) + "\n";

function streamResponse(records, byteSize = 17, trailingNewline = true) {
  const text = records.map(line).join("");
  const bytes = encoder.encode(trailingNewline ? text : text.trimEnd());
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += byteSize) {
        controller.enqueue(bytes.subarray(offset, offset + byteSize));
      }
      controller.close();
    },
  }));
}

function mockTurns(t, turns) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const records = turns[requests.length - 1];
    assert.ok(records, "Unexpected extra Model request");
    return streamResponse(records);
  });
  return requests;
}

function turn(action, thinking = "Decide from context") {
  const content = JSON.stringify(action);
  return [
    chunk({ thinking }),
    chunk({ content: content.slice(0, 9) }),
    chunk({ content: content.slice(9) }, true),
  ];
}

test("Ollama accumulates thinking/content across NDJSON, JSON and UTF-8 byte boundaries", async (t) => {
  const requests = [];
  const content = JSON.stringify(final);
  const deltas = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://localhost:11434/api/chat");
    requests.push(JSON.parse(options.body));
    return streamResponse([
      chunk({ thinking: "先思考🙂" }),
      chunk({ content: content.slice(0, 2), thinking: "再分析" }),
      chunk({ content: content.slice(2, 13) }),
      chunk({ content: content.slice(13) }, true),
    ], 1);
  });
  const response = await callModel([{ role: "user", content: "Question" }], "json", (delta) => deltas.push(delta));
  assert.deepEqual(response, { content, thinking: "先思考🙂再分析", thinkingTruncated: false });
  assert.deepEqual(deltas, ["先思考🙂", "再分析"]);
  assert.equal(requests[0].think, true);
  assert.equal(requests[0].stream, true);
  assert.equal(requests[0].format, "json");
});

test("Ollama accepts a terminal record without a message or trailing newline", async (t) => {
  t.mock.method(globalThis, "fetch", async () => streamResponse([
    chunk({ content: JSON.stringify(final) }),
    { done: true },
  ], 11, false));
  assert.equal((await callModel([])).content, JSON.stringify(final));
});

test("Core waits for done before parsing partial JSON or dispatching a complete tool action", async (t) => {
  for (const completeEarly of [false, true]) {
    let controller;
    const content = JSON.stringify(completeEarly ? tool("read_file", "src/index.ts") : final);
    const prefix = completeEarly ? content : content.slice(0, 8);
    const events = [];
    const trace = [];
    let reachedThinking;
    const thinkingReceived = new Promise((resolve) => { reachedThinking = resolve; });
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      if (requests > 1) return streamResponse(turn(final));
      return new Response(new ReadableStream({
        start(streamController) {
          controller = streamController;
          controller.enqueue(encoder.encode(line(chunk({ content: prefix }))));
          controller.enqueue(encoder.encode(line(chunk({ thinking: "still running" }))));
        },
      }));
    });
    const running = runAgent("Question", (entry) => trace.push(entry), (event) => {
      events.push(event);
      if (event.type === "model_thinking_delta") reachedThinking();
    });
    try {
      await thinkingReceived;
      assert.deepEqual(events.map((event) => event.type), ["iteration_started", "model_thinking_delta"]);
      assert.deepEqual(trace, []);
    } finally {
      controller.enqueue(encoder.encode(line(chunk({ content: completeEarly ? "" : content.slice(8) }, true))));
      controller.close();
    }
    assert.equal((await running).answer, final.answer);
    assert.equal(events.at(-1).type, "final");
    assert.equal(events.filter((event) => event.type === "tool_started").length, completeEarly ? 1 : 0);
    t.mock.restoreAll();
  }
});

test("EOF before done is a model failure even if content is already valid AgentAction JSON", async (t) => {
  t.mock.method(console, "error", () => {});
  const requests = mockTurns(t, [[chunk({ thinking: "partial thinking", content: JSON.stringify(final) })]]);
  const events = [];
  await assert.rejects(() => runAgent("Question", undefined, (event) => events.push(event)), (error) => {
    assert.ok(error instanceof AgentExecutionError);
    assert.ok(error.cause instanceof ModelStreamError);
    assert.match(error.message, /ended before done/);
    assert.equal(error.trace[0].layer, "model");
    assert.equal(error.trace[0].thinking, "partial thinking");
    assert.equal(error.trace[0].thinkingTruncated, false);
    return true;
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(events.map((event) => event.type), ["iteration_started", "model_thinking_delta", "error"]);
});

test("a transport interruption fails clearly and retains bounded partial thinking", async (t) => {
  t.mock.method(console, "error", () => {});
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(controller) {
      if (reads++ === 0) controller.enqueue(encoder.encode(line(chunk({ thinking: "a".repeat(MAX_THINKING_CHARS + 9) }))));
      else controller.error(new Error("connection interrupted"));
    },
  })));
  const eventTypes = [];
  await assert.rejects(() => runAgent("Question", undefined, (event) => eventTypes.push(event.type)), (error) => {
    assert.match(error.message, /connection interrupted/);
    assert.equal(error.trace[0].thinking.length, MAX_THINKING_CHARS);
    assert.equal(error.trace[0].thinkingTruncated, true);
    assert.equal(error.cause.cause.message, "connection interrupted");
    return true;
  });
  assert.deepEqual(eventTypes, ["iteration_started", "model_thinking_delta", "error"]);
});

test("malformed stream records, invalid fields and Ollama error records fail with causes", async (t) => {
  for (const [record, reason] of [
    ["not NDJSON\n", /JSON/],
    [line(null), /JSON object/],
    [line([]), /JSON object/],
    [line({ message: { content: "x" } }), /boolean done/],
    [line({ done: false }), /missing message/],
    [line(chunk(null)), /invalid message/],
    [line(chunk({ content: 42 })), /content must be a string/],
    [line(chunk({ thinking: 42 })), /thinking must be a string/],
    [line({ error: "server interrupted" }), /server interrupted/],
  ]) {
    t.mock.method(globalThis, "fetch", async () => new Response(record));
    await assert.rejects(() => callModel([]), (error) => {
      assert.ok(error instanceof ModelStreamError);
      assert.ok(error.cause instanceof Error);
      assert.match(error.message, reason);
      return true;
    });
    t.mock.restoreAll();
  }
});

test("HTTP failures and a missing response body remain explicit model errors", async (t) => {
  for (const [response, reason] of [
    [new Response("Unavailable", { status: 503 }), /HTTP 503/],
    [new Response(null), /missing a stream body/],
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(() => callModel([]), reason);
    t.mock.restoreAll();
  }
});

test("tool events report real start/completion and retain observations plus final thinking", async (t) => {
  const actions = [tool("list_files", "."), tool("read_file", "src/index.ts"), final];
  const requests = mockTurns(t, actions.map((action, index) => turn(action, `thinking ${index + 1}`)));
  const events = [];
  const trace = [];
  const result = await runAgent("Question", (entry) => trace.push(entry), (event) => {
    if (event.type === "tool_started") {
      assert.equal(trace.some((entry) => entry.iteration === event.iteration), false);
    }
    if (event.type === "tool_completed") {
      assert.equal(trace.at(-1).status, "success");
      assert.deepEqual(event.observation, trace.at(-1).observation);
    }
    events.push(event);
  });
  assert.equal(result.answer, final.answer);
  assert.deepEqual(result.trace, trace);
  assert.deepEqual(events.map((event) => event.type), [
    "iteration_started", "model_thinking_delta", "tool_started", "tool_completed",
    "iteration_started", "model_thinking_delta", "tool_started", "tool_completed",
    "iteration_started", "model_thinking_delta", "final",
  ]);
  assert.deepEqual(events.map((event) => event.iteration), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
  assert.deepEqual(events.at(-1), { type: "final", iteration: 3, answer: final.answer });
  assert.deepEqual(result.trace.map((entry) => entry.thinking), ["thinking 1", "thinking 2", "thinking 3"]);
  assert.ok(result.trace.every((entry) => entry.thinkingTruncated === false));
  assert.ok(result.trace.every((entry) => !Object.keys(entry).some((key) => /delta/i.test(key))));
  const listing = result.trace[0].observation;
  assert.equal(listing.type, "list_files");
  assert.equal(listing.path, ".");
  assert.equal(listing.count, listing.entries.length);
  assert.ok(listing.count <= MAX_LIST_ENTRIES);
  assert.ok(listing.entries.some((entry) => entry.name === "src" && entry.type === "directory"));
  const content = readFileSync("example-repo/src/index.ts", "utf-8");
  assert.deepEqual(result.trace[1].observation, {
    type: "read_file", path: "src/index.ts", bytes: Buffer.byteLength(content), lines: 5, content,
  });
  assert.equal(requests[1].messages.at(-1).content.split("\n").slice(1).join("\n"), JSON.stringify(listing.entries));
  assert.equal(requests[2].messages.at(-1).content.split("\n").slice(1).join("\n"), content);
  assert.ok(!events.some((event) => event.type === "model_content_delta" || event.type === "model_completed"));
});

test("thinking limit is enforced while buffering, independently per iteration, while all deltas emit", async (t) => {
  const thinkingChunks = ["a".repeat(MAX_THINKING_CHARS - 2), "bcdef", "later"];
  mockTurns(t, [
    [...thinkingChunks.map((thinking) => chunk({ thinking })), chunk({ content: JSON.stringify(tool("list_files", ".")) }, true)],
    turn(final, "new iteration"),
  ]);
  const deltas = [];
  const result = await runAgent("Question", undefined, (event) => {
    if (event.type === "model_thinking_delta") deltas.push(event.delta);
  });
  assert.equal(result.trace[0].thinking, "a".repeat(MAX_THINKING_CHARS - 2) + "bc");
  assert.equal(result.trace[0].thinking.length, MAX_THINKING_CHARS);
  assert.equal(result.trace[0].thinkingTruncated, true);
  assert.equal(result.trace[1].thinking, "new iteration");
  assert.equal(result.trace[1].thinkingTruncated, false);
  assert.deepEqual(deltas, [...thinkingChunks, "new iteration"]);
});

test("thinking exactly at the limit is not marked truncated; absence of thinking is supported", async (t) => {
  mockTurns(t, [turn(tool("list_files", "."), "a".repeat(MAX_THINKING_CHARS)), turn(final, "")]);
  const events = [];
  const result = await runAgent("Question", undefined, (event) => events.push(event));
  assert.equal(result.trace[0].thinking.length, MAX_THINKING_CHARS);
  assert.equal(result.trace[0].thinkingTruncated, false);
  assert.equal(result.trace[1].thinking, "");
  assert.equal(events.filter((event) => event.type === "model_thinking_delta").length, 1);
});

test("tool failure emits started then error, terminates and preserves earlier success plus failure thinking", async (t) => {
  const diagnostics = [];
  t.mock.method(console, "error", (message) => diagnostics.push(message));
  const requests = mockTurns(t, [turn(tool("list_files", ".")), turn(tool("read_file", "../package.json"), "failure thinking")]);
  const events = [];
  await assert.rejects(() => runAgent("Question", undefined, (event) => events.push(event)), (error) => {
    assert.ok(error instanceof AgentExecutionError);
    assert.equal(error.trace.length, 2);
    assert.equal(error.trace[0].status, "success");
    assert.equal(error.trace[1].status, "failure");
    assert.equal(error.trace[1].thinking, "failure thinking");
    assert.equal(error.trace[1].observation, undefined);
    assert.match(error.message, /workspace_boundary/);
    assert.ok(error.cause instanceof Error);
    return true;
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(events.filter((event) => event.iteration === 2).map((event) => event.type), [
    "iteration_started", "model_thinking_delta", "tool_started", "error",
  ]);
  assert.deepEqual(events.at(-1), { type: "error", iteration: 2, layer: "tool", error: "Tool read_file failed. Run terminated." });
  assert.match(diagnostics[0], /workspace_boundary/);
});

test("invalid actions keep bounded diagnostics and thinking without exposing raw output in events", async (t) => {
  for (const content of ["RAW_MODEL_SENTINEL".repeat(2000), JSON.stringify(tool("write_file", "RAW_MODEL_SENTINEL"))]) {
    const diagnostics = [];
    t.mock.method(console, "error", (message) => diagnostics.push(message));
    mockTurns(t, [[chunk({ thinking: "action thinking" }), chunk({ content }, true)]]);
    const events = [];
    await assert.rejects(() => runAgent("Question", undefined, (event) => events.push(event)), (error) => {
      assert.equal(error.trace[0].layer, "action");
      assert.equal(error.trace[0].thinking, "action thinking");
      assert.match(error.message, /RAW_MODEL_SENTINEL/);
      assert.ok(error.message.length < 1800);
      return true;
    });
    assert.equal(events.at(-1).layer, "action");
    assert.doesNotMatch(JSON.stringify(events), /RAW_MODEL_SENTINEL/);
    assert.ok(diagnostics[0].length < 1800);
    t.mock.restoreAll();
  }
});

test("model diagnostics stay out of error events and iteration limit terminates after eight calls", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => streamResponse([{ error: "PRIVATE_DIAGNOSTIC" }]));
  const modelEvents = [];
  await assert.rejects(() => runAgent("Question", undefined, (event) => modelEvents.push(event)), /PRIVATE_DIAGNOSTIC/);
  assert.deepEqual(modelEvents.map((event) => event.type), ["iteration_started", "error"]);
  assert.doesNotMatch(JSON.stringify(modelEvents), /PRIVATE_DIAGNOSTIC/);
  const requests = mockTurns(t, Array.from({ length: 8 }, () => turn(tool("list_files", "."))));
  const events = [];
  await assert.rejects(() => runAgent("Question", undefined, (event) => events.push(event)), (error) => {
    assert.equal(error.trace.length, 9);
    assert.equal(error.trace.at(-1).layer, "iteration_limit");
    return true;
  });
  assert.equal(requests.length, 8);
  assert.equal(events.filter((event) => event.type === "tool_completed").length, 8);
  assert.equal(events.at(-1).layer, "iteration_limit");
});

// Generated fixtures are isolated inside the existing fixed Agent workspace.
const fixtureRoot = await mkdtemp(path.join("example-repo", ".phase5a-test-"));
after(async () => { await rm(fixtureRoot, { recursive: true, force: true }); });
const relativeFixture = path.basename(fixtureRoot);

test("read_file trace and event preserve full 64KiB content with unchanged Model feedback", async (t) => {
  const prefix = "中文🙂\r\n".repeat(1000);
  const content = prefix + "a".repeat(MAX_READ_FILE_BYTES - Buffer.byteLength(prefix));
  assert.equal(Buffer.byteLength(content), MAX_READ_FILE_BYTES);
  await writeFile(path.join(fixtureRoot, "full.txt"), content);
  const filePath = `${relativeFixture}/full.txt`;
  const requests = mockTurns(t, [turn(tool("read_file", filePath)), turn(final)]);
  const events = [];
  const result = await runAgent("Question", undefined, (event) => events.push(event));
  const observation = result.trace[0].observation;
  assert.equal(observation.content, content);
  assert.equal(observation.bytes, MAX_READ_FILE_BYTES);
  assert.equal(observation.lines, 1001);
  assert.deepEqual(events.find((event) => event.type === "tool_completed").observation, observation);
  assert.ok(requests[1].messages.at(-1).content.endsWith(content));
});

test("read_file observation counts empty text and newline variants consistently", async (t) => {
  for (const [content, lines] of [["", 0], ["one", 1], ["one\n", 1], ["\n\n", 2], ["one\r\ntwo\r", 2]]) {
    await writeFile(path.join(fixtureRoot, "lines.txt"), content);
    mockTurns(t, [turn(tool("read_file", `${relativeFixture}/lines.txt`)), turn(final)]);
    const result = await runAgent("Question");
    assert.equal(result.trace[0].observation.lines, lines);
    assert.equal(result.trace[0].observation.bytes, Buffer.byteLength(content));
    t.mock.restoreAll();
  }
});

test("tool_started is delivered before the real filesystem operation", async (t) => {
  const filePath = `${relativeFixture}/created-at-start.txt`;
  mockTurns(t, [turn(tool("read_file", filePath)), turn(final)]);
  const events = [];
  const result = await runAgent("Question", undefined, (event) => {
    events.push(event);
    if (event.type === "tool_started") {
      writeFileSync(path.join(fixtureRoot, "created-at-start.txt"), "created when tool started");
    }
  });
  assert.equal(result.trace[0].observation.content, "created when tool started");
  assert.deepEqual(events.filter((event) => event.type.startsWith("tool_")).map((event) => event.type), ["tool_started", "tool_completed"]);
});

test("structured list observation retains exactly 200 entries; excessive entries or file bytes fail fast", async (t) => {
  t.mock.method(console, "error", () => {});
  const directory = path.join(fixtureRoot, "many");
  await mkdir(directory);
  await Promise.all(Array.from({ length: MAX_LIST_ENTRIES }, (_, index) => writeFile(path.join(directory, `file-${index}`), "")));
  const listAction = tool("list_files", `${relativeFixture}/many`);
  mockTurns(t, [turn(listAction), turn(final)]);
  const result = await runAgent("Question");
  assert.equal(result.trace[0].observation.count, MAX_LIST_ENTRIES);
  assert.equal(result.trace[0].observation.entries.length, MAX_LIST_ENTRIES);
  await writeFile(path.join(directory, "extra"), "");
  await writeFile(path.join(fixtureRoot, "oversized.txt"), Buffer.alloc(MAX_READ_FILE_BYTES + 1));
  for (const action of [listAction, tool("read_file", `${relativeFixture}/oversized.txt`)]) {
    const requests = mockTurns(t, [turn(action)]);
    const eventTypes = [];
    await assert.rejects(() => runAgent("Question", undefined, (event) => eventTypes.push(event.type)), (error) => {
      assert.equal(error.trace[0].status, "failure");
      assert.match(error.message, /size_limit/);
      return true;
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(eventTypes, ["iteration_started", "model_thinking_delta", "tool_started", "error"]);
  }
});

test("different questions preserve model-selected read/list orders and a direct final", async (t) => {
  const sequences = [
    [tool("read_file", "src/index.ts"), tool("list_files", "."), final],
    [tool("list_files", "src"), tool("read_file", "src/index.ts"), final],
    [final],
  ];
  for (const [index, sequence] of sequences.entries()) {
    const question = `Question ${index + 1}`;
    const requests = mockTurns(t, sequence.map((action) => turn(action)));
    const result = await runAgent(question);
    assert.equal(requests[0].messages[1].content, question);
    assert.deepEqual(result.trace.map((entry) => entry.type === "tool" ? entry.tool : entry.type), sequence.map((action) => action.type === "tool" ? action.tool : action.type));
    t.mock.restoreAll();
  }
});

test("CLI success prints full final answer and concise trace without thinking", async (t) => {
  mockTurns(t, [turn(tool("read_file", "src/index.ts"), "THINKING_NOT_PRINTED"), turn(final, "THINKING_NOT_PRINTED")]);
  const output = [];
  const errors = [];
  t.mock.method(console, "log", (...args) => output.push(args.join(" ")));
  t.mock.method(console, "error", (...args) => errors.push(args.join(" ")));
  const originalArgs = process.argv;
  const originalExitCode = process.exitCode;
  try {
    process.argv = [process.execPath, "src/index.ts", "Question"];
    process.exitCode = undefined;
    await import("../src/index.ts?phase5a-success");
    assert.match(output.join("\n"), /read_file.*success/);
    assert.match(output.join("\n"), /\[2\] final/);
    assert.ok(output.join("\n").includes(final.answer));
    assert.doesNotMatch(output.join("\n"), /THINKING_NOT_PRINTED/);
    assert.deepEqual(errors, []);
    assert.equal(process.exitCode, undefined);
  } finally {
    process.argv = originalArgs;
    process.exitCode = originalExitCode;
  }
});
