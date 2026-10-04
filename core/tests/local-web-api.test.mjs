import assert from "node:assert/strict";
import { test } from "node:test";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { createAgentServer } from "../src/server/server.ts";
import { AgentExecutionError } from "../src/agent/trace.ts";

function deferred() {
  const { promise, resolve } = Promise.withResolvers();
  return { promise, resolve };
}

async function startServer(t, options = {}) {
  const server = createAgentServer(options);
  t.after(async () => {
    const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  assert.equal(server.address().address, "127.0.0.1");
  return { server, url: `http://127.0.0.1:${server.address().port}/api/agent/run` };
}

function request(url, body = JSON.stringify({ question: "Question" }), options = {}) {
  return new Promise((resolve, reject) => {
    const client = httpRequest(url, {
      method: "POST",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    }, (response) => resolve(response));
    client.on("error", reject);
    client.end(body);
  });
}

async function text(response) {
  response.setEncoding("utf-8");
  let body = "";
  for await (const chunk of response) body += chunk;
  return body;
}

async function events(response) {
  const body = await text(response);
  assert.ok(body.endsWith("\n"), "NDJSON must end with a newline");
  return body.slice(0, -1).split("\n").map((line) => JSON.parse(line));
}

const finalEvent = { type: "final", iteration: 1, answer: "完整回答\n中文 🙂" };
async function successfulRun(_question, _onTrace, onEvent) {
  onEvent({ type: "iteration_started", iteration: 1 });
  onEvent(finalEvent);
  return { answer: finalEvent.answer, trace: [] };
}

test("HTTP streams unchanged Core events before run completion and ends only after runAgent resolves", { timeout: 5000 }, async (t) => {
  const continueRun = deferred();
  const finishRun = deferred();
  t.after(() => { continueRun.resolve(); finishRun.resolve(); });
  const expected = [
    { type: "iteration_started", iteration: 1 },
    { type: "model_thinking_delta", iteration: 1, delta: "thinking\n中文 🙂" },
    { type: "tool_started", iteration: 1, tool: "read_file", input: { path: "src/index.ts" } },
    { type: "tool_completed", iteration: 1, tool: "read_file", input: { path: "src/index.ts" }, observation: {
      type: "read_file", path: "src/index.ts", bytes: 5, lines: 1, content: "file\n",
    } },
    { type: "iteration_started", iteration: 2 },
    { type: "final", iteration: 2, answer: finalEvent.answer },
  ];
  let receivedQuestion;
  let resolved = false;
  const { url } = await startServer(t, { runAgent: async (question, onTrace, onEvent) => {
    receivedQuestion = question;
    assert.equal(onTrace, undefined);
    onEvent(expected[0]);
    onEvent(expected[1]);
    await continueRun.promise;
    for (const event of expected.slice(2)) onEvent(event);
    await finishRun.promise;
    resolved = true;
    return { answer: finalEvent.answer, trace: [] };
  } });
  const response = await request(url, JSON.stringify({ question: "  問題  " }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/x-ndjson; charset=utf-8");
  const firstEvents = deferred();
  const finalReceived = deferred();
  const received = [];
  let pending = "";
  response.setEncoding("utf-8");
  response.on("data", (data) => {
    pending += data;
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      received.push(JSON.parse(pending.slice(0, newline)));
      pending = pending.slice(newline + 1);
      if (received.length === 2) firstEvents.resolve();
      if (received.at(-1).type === "final") finalReceived.resolve();
    }
  });
  const ended = once(response, "end");
  await firstEvents.promise;
  assert.equal(receivedQuestion, "問題");
  assert.deepEqual(received, expected.slice(0, 2));
  assert.equal(resolved, false);
  continueRun.resolve();
  await finalReceived.promise;
  assert.equal(response.readableEnded, false);
  assert.equal(resolved, false);
  finishRun.resolve();
  await ended;
  assert.equal(resolved, true);
  assert.equal(pending, "");
  assert.deepEqual(received, expected);
});

test("invalid Content-Type, JSON and question return JSON 400 without invoking the Agent", async (t) => {
  let calls = 0;
  const { url } = await startServer(t, { runAgent: async (...args) => {
    calls++;
    return successfulRun(...args);
  } });
  for (const [body, headers] of [
    ["{invalid JSON", {}],
    ["", {}],
    ["{}", {}],
    ['{"question":""}', {}],
    ['{"question":" \t "}', {}],
    ['{"question":42}', {}],
    ['{"question":null}', {}],
    ["null", {}],
    ["[]", {}],
    ['{"question":"Question"}', { "Content-Type": "text/plain" }],
    ['{"question":"Question"}', { "Content-Type": "" }],
    [JSON.stringify({ question: "a".repeat(64 * 1024) }), {}],
  ]) {
    const response = await request(url, body, { headers });
    assert.equal(response.statusCode, 400);
    assert.match(response.headers["content-type"], /^application\/json/);
    const result = JSON.parse(await text(response));
    assert.equal(result.error.code, "INVALID_REQUEST");
    assert.ok(result.error.message.length < 200);
    assert.doesNotMatch(result.error.message, /stack|invalid JSON/);
  }
  assert.equal(calls, 0);
  const valid = await request(url, JSON.stringify({ question: "Question" }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  assert.equal(valid.statusCode, 200);
  assert.deepEqual((await events(valid)).at(-1), finalEvent);
  assert.equal(calls, 1);
});

test("one active run returns 409 to overlapping requests and releases busy after success", { timeout: 5000 }, async (t) => {
  const release = deferred();
  t.after(() => release.resolve());
  let calls = 0;
  const { url } = await startServer(t, { runAgent: async (...args) => {
    if (++calls === 1) await release.promise;
    return successfulRun(...args);
  } });
  const first = await request(url);
  const firstEvents = events(first);
  const second = await request(url);
  assert.equal(second.statusCode, 409);
  assert.deepEqual(JSON.parse(await text(second)), {
    error: { code: "AGENT_BUSY", message: "An agent run is already in progress." },
  });
  assert.equal(calls, 1);
  release.resolve();
  await firstEvents;
  const third = await request(url);
  assert.equal(third.statusCode, 200);
  await events(third);
  assert.equal(calls, 2);
});

test("runtime failure sends the Core error once, ends normally and releases busy", async (t) => {
  let calls = 0;
  const errorEvent = { type: "error", iteration: 1, layer: "tool", error: "Tool read_file failed. Run terminated." };
  const { url } = await startServer(t, { runAgent: async (...args) => {
    if (++calls > 1) return successfulRun(...args);
    const onEvent = args[2];
    onEvent({ type: "iteration_started", iteration: 1 });
    onEvent({ type: "tool_started", iteration: 1, tool: "read_file", input: { path: "missing.txt" } });
    onEvent(errorEvent);
    throw new AgentExecutionError("PRIVATE_DIAGNOSTICS", []);
  } });
  const failed = await request(url);
  assert.equal(failed.statusCode, 200);
  const received = await events(failed);
  assert.deepEqual(received.map((event) => event.type), ["iteration_started", "tool_started", "error"]);
  assert.deepEqual(received.at(-1), errorEvent);
  assert.equal(received.filter((event) => event.type === "error").length, 1);
  assert.doesNotMatch(JSON.stringify(received), /PRIVATE_DIAGNOSTICS|stack/);
  const next = await request(url);
  assert.equal(next.statusCode, 200);
  await events(next);
});

test("unexpected execution failure closes the connection without leaking diagnostics and releases busy", { timeout: 5000 }, async (t) => {
  const fail = deferred();
  t.after(() => fail.resolve());
  const diagnostics = [];
  t.mock.method(console, "error", (message) => diagnostics.push(message));
  let calls = 0;
  const { url } = await startServer(t, { runAgent: async (...args) => {
    if (++calls > 1) return successfulRun(...args);
    args[2]({ type: "iteration_started", iteration: 1 });
    await fail.promise;
    throw new Error("PRIVATE_UNEXPECTED_DIAGNOSTIC");
  } });
  const first = await request(url);
  first.setEncoding("utf-8");
  const [firstChunk] = await once(first, "data");
  assert.equal(JSON.parse(firstChunk).type, "iteration_started");
  const reading = text(first);
  const failedReading = assert.rejects(reading);
  fail.resolve();
  await failedReading;
  assert.doesNotMatch(firstChunk, /PRIVATE_UNEXPECTED_DIAGNOSTIC/);
  assert.match(diagnostics[0], /PRIVATE_UNEXPECTED_DIAGNOSTIC/);
  const next = await request(url);
  assert.equal(next.statusCode, 200);
  await events(next);
});

test("CORS preflight and responses allow only the configured origin", async (t) => {
  let calls = 0;
  const webOrigin = "http://localhost:4321";
  const { url } = await startServer(t, { webOrigin, runAgent: async (...args) => {
    calls++;
    return successfulRun(...args);
  } });
  const preflight = await request(url, "", { method: "OPTIONS", headers: {
    Origin: webOrigin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
  } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], webOrigin);
  assert.equal(preflight.headers["access-control-allow-methods"], "POST, OPTIONS");
  assert.equal(preflight.headers["access-control-allow-headers"], "Content-Type");
  assert.equal(await text(preflight), "");
  assert.equal(calls, 0);
  const allowed = await request(url, undefined, { headers: { Origin: webOrigin } });
  assert.equal(allowed.headers["access-control-allow-origin"], webOrigin);
  assert.equal(allowed.headers.vary, "Origin");
  await events(allowed);
  const invalid = await request(url, "{}", { headers: { Origin: webOrigin } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.headers["access-control-allow-origin"], webOrigin);
  await text(invalid);
  const other = await request(url, "", { method: "OPTIONS", headers: { Origin: "http://unconfigured.example" } });
  assert.equal(other.headers["access-control-allow-origin"], undefined);
  await text(other);
});

test("default CORS origin, unknown routes and unsupported methods preserve the API boundary", async (t) => {
  let calls = 0;
  const { url } = await startServer(t, { runAgent: async (...args) => {
    calls++;
    return successfulRun(...args);
  } });
  const response = await request(url, undefined, { headers: { Origin: "http://localhost:3000" } });
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:3000");
  await events(response);
  const missing = await request(url.replace("/api/agent/run", "/missing"));
  assert.equal(missing.statusCode, 404);
  assert.equal(JSON.parse(await text(missing)).error.code, "NOT_FOUND");
  const get = await request(url, "", { method: "GET" });
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.allow, "POST, OPTIONS");
  await text(get);
  assert.equal(calls, 1);
});

test("disconnect stops HTTP writes while Core continues and busy remains until the run ends", { timeout: 5000 }, async (t) => {
  const release = deferred();
  const runFinished = deferred();
  const responseClosed = deferred();
  t.after(() => release.resolve());
  let calls = 0;
  let writesAfterClose = 0;
  let resumed = false;
  const { server, url } = await startServer(t, { runAgent: async (...args) => {
    if (++calls > 1) return successfulRun(...args);
    args[2]({ type: "iteration_started", iteration: 1 });
    await release.promise;
    resumed = true;
    args[2]({ type: "model_thinking_delta", iteration: 1, delta: "after disconnect" });
    args[2](finalEvent);
    runFinished.resolve();
    return { answer: finalEvent.answer, trace: [] };
  } });
  server.on("request", (_request, response) => {
    if (calls !== 0) return;
    const originalWrite = response.write.bind(response);
    response.write = (...args) => {
      if (response.destroyed) writesAfterClose++;
      return originalWrite(...args);
    };
    response.on("close", () => responseClosed.resolve());
  });
  const first = await request(url);
  await once(first, "data");
  first.destroy();
  await responseClosed.promise;
  assert.equal(resumed, false);
  const busy = await request(url);
  assert.equal(busy.statusCode, 409);
  await text(busy);
  release.resolve();
  await runFinished.promise;
  const next = await request(url);
  assert.equal(next.statusCode, 200);
  await events(next);
  assert.equal(resumed, true);
  assert.equal(writesAfterClose, 0);
});

test("HTTP integration with real Core preserves tool observations and fail-fast error events using mocked Ollama", async (t) => {
  const diagnostics = [];
  t.mock.method(console, "error", (message) => diagnostics.push(message));
  const actions = [
    { type: "tool", tool: "read_file", input: { path: "src/index.ts" } },
    { type: "final", answer: "Hello, Agent!" },
    { type: "tool", tool: "read_file", input: { path: "../package.json" } },
  ];
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const action = actions[requests.length - 1];
    assert.ok(action);
    return new Response(
      JSON.stringify({ done: false, message: { thinking: "Core thinking" } }) + "\n" +
      JSON.stringify({ done: true, message: { content: JSON.stringify(action) } }) + "\n"
    );
  });
  const { url } = await startServer(t);
  const success = await events(await request(url));
  assert.deepEqual(success.map((event) => event.type), [
    "iteration_started", "model_thinking_delta", "tool_started", "tool_completed",
    "iteration_started", "model_thinking_delta", "final",
  ]);
  assert.match(success[3].observation.content, /greet\("Agent"\)/);
  assert.equal(success.at(-1).answer, "Hello, Agent!");
  const failure = await events(await request(url));
  assert.deepEqual(failure.map((event) => event.type), ["iteration_started", "model_thinking_delta", "tool_started", "error"]);
  assert.equal(failure.at(-1).layer, "tool");
  assert.doesNotMatch(failure.at(-1).error, /workspace_boundary|stack|package.json/);
  assert.match(diagnostics[0], /workspace_boundary/);
  assert.ok(requests.every((request) => request.stream === true && request.think === true));
});
