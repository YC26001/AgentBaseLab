import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listFiles } from "../src/tools/list-files.ts";
import { readFileTool } from "../src/tools/read-file.ts";
import { parseAgentAction } from "../src/agent/action.ts";
import { runAgent } from "../src/agent/agent.ts";
import { AgentExecutionError } from "../src/agent/trace.ts";
import { MAX_READ_FILE_BYTES, MAX_LIST_ENTRIES, MAX_TOOL_OUTPUT_BYTES } from "../src/limits.ts";

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentbaselab-hardening-"));
after(async () => { await rm(temporaryRoot, { recursive: true, force: true }); });
const workspace = path.join(temporaryRoot, "workspace");
const outside = path.join(temporaryRoot, "outside");
await mkdir(path.join(workspace, "docs"), { recursive: true });
await mkdir(outside);
await mkdir(path.join(temporaryRoot, "workspace-other"));
await writeFile(path.join(workspace, "README.md"), "Workspace README\n");
await writeFile(path.join(workspace, "notes..txt"), "Dots in a filename are valid\n");
await writeFile(path.join(workspace, "docs/content.txt"), "中文內容\n");
await writeFile(path.join(outside, "private.txt"), "OUTSIDE_SENTINEL\n");
await symlink("../outside", path.join(workspace, "outside"));
await symlink("../outside/private.txt", path.join(workspace, "outside-file"));
await symlink("docs", path.join(workspace, "inside"));
await symlink("../missing", path.join(workspace, "broken"));
await symlink(workspace, path.join(temporaryRoot, "workspace-alias"));

test("normal Tools return names, types and complete UTF-8 text", async () => {
  const entries = await listFiles(workspace);
  assert.ok(entries.some((entry) => entry.name === "docs" && entry.type === "directory"));
  assert.ok(entries.some((entry) => entry.name === "README.md" && entry.type === "file"));
  assert.deepEqual(await listFiles(workspace, "docs"), [{ name: "content.txt", type: "file" }]);
  assert.equal(await readFileTool(workspace, "docs/content.txt"), "中文內容\n");
  assert.equal(await readFileTool(workspace, "docs/../README.md"), "Workspace README\n");
  assert.equal(await readFileTool(workspace, "notes..txt"), "Dots in a filename are valid\n");
});

test("both Tools reject traversal and prefix-sibling escapes", async () => {
  for (const requested of ["../package.json", "../../etc/passwd", "docs/../../package.json", "../workspace-other"]) {
    await assert.rejects(() => readFileTool(workspace, requested), /workspace_boundary.*escapes workspace/);
    await assert.rejects(() => listFiles(workspace, requested), /workspace_boundary.*escapes workspace/);
  }
});

test("both Tools reject absolute paths including Windows drive and UNC paths", async () => {
  for (const requested of ["/etc/passwd", "C:\\Windows\\system.ini", "\\\\server\\share\\file.txt"]) {
    await assert.rejects(() => readFileTool(workspace, requested), /Absolute paths are not allowed/);
    await assert.rejects(() => listFiles(workspace, requested), /Absolute paths are not allowed/);
  }
});

test("both Tools validate untrusted runtime path values", async () => {
  for (const requested of [null, false, 42, {}, [], "", " \t", "bad\0path"]) {
    await assert.rejects(() => readFileTool(workspace, requested), /path_input/);
    await assert.rejects(() => listFiles(workspace, requested), /path_input/);
  }
  await assert.rejects(() => readFileTool(workspace, undefined), /must be a string/);
});

test("symlink escape is rejected by both Tools; internal links and root aliases work", async () => {
  await assert.rejects(() => readFileTool(workspace, "outside/private.txt"), /escapes workspace/);
  await assert.rejects(() => readFileTool(workspace, "outside-file"), /escapes workspace/);
  await assert.rejects(() => listFiles(workspace, "outside"), /escapes workspace/);
  assert.equal(await readFileTool(workspace, "inside/content.txt"), "中文內容\n");
  assert.deepEqual(await listFiles(workspace, "inside"), [{ name: "content.txt", type: "file" }]);
  assert.equal(await readFileTool(path.join(temporaryRoot, "workspace-alias"), "README.md"), "Workspace README\n");
});

test("missing paths and broken symlinks preserve filesystem causes", async () => {
  for (const requested of ["missing.txt", "broken", "broken/file.txt"]) {
    for (const tool of [readFileTool, listFiles]) {
      await assert.rejects(() => tool(workspace, requested), (error) => {
        assert.match(error.message, /filesystem.*Cannot resolve/);
        assert.equal(error.cause.code, "ENOENT");
        return true;
      });
    }
  }
  await assert.rejects(() => readFileTool(workspace, "docs"), /requires a regular file/);
  await assert.rejects(() => listFiles(workspace, "README.md"), /ENOTDIR/);
});

test("read_file accepts the exact byte limit and rejects oversized files", async () => {
  await writeFile(path.join(workspace, "exact.txt"), Buffer.alloc(MAX_READ_FILE_BYTES, "a"));
  await writeFile(path.join(workspace, "oversized.txt"), Buffer.alloc(MAX_READ_FILE_BYTES + 1, "a"));
  assert.equal((await readFileTool(workspace, "exact.txt")).length, MAX_READ_FILE_BYTES);
  await assert.rejects(() => readFileTool(workspace, "oversized.txt"), /size_limit.*read_file exceeds/);
});

test("decoded read_file output is bounded too", async () => {
  await writeFile(path.join(workspace, "invalid-utf8.txt"), Buffer.alloc(MAX_READ_FILE_BYTES, 0xff));
  await assert.rejects(() => readFileTool(workspace, "invalid-utf8.txt"), /size_limit.*output exceeds/);
});

test("list_files accepts exactly the entry limit then refuses an extra entry", async () => {
  const many = path.join(workspace, "many");
  await mkdir(many);
  await Promise.all(Array.from({ length: MAX_LIST_ENTRIES }, (_, index) =>
    writeFile(path.join(many, `file-${index}`), "")));
  assert.equal((await listFiles(workspace, "many")).length, MAX_LIST_ENTRIES);
  await writeFile(path.join(many, "extra"), "");
  await assert.rejects(() => listFiles(workspace, "many"), /size_limit.*entries/);
});

test("list_files refuses excessive serialized output even below the entry count limit", async () => {
  const escaped = path.join(workspace, "escaped-names");
  await mkdir(escaped);
  const count = Math.min(MAX_LIST_ENTRIES, 60);
  const names = Array.from({ length: count }, (_, index) => "\u0001".repeat(220) + index);
  assert.ok(Buffer.byteLength(JSON.stringify(names)) > MAX_TOOL_OUTPUT_BYTES);
  await Promise.all(names.map((name) => writeFile(path.join(escaped, name), "")));
  await assert.rejects(() => listFiles(workspace, "escaped-names"), /size_limit.*output exceeds/);
});

test("invalid AgentAction diagnostics identify the layer, reason and bounded raw output", () => {
  for (const [text, reason] of [
    ["not JSON", /model_json.*not valid JSON/],
    ['{"type":"unknown"}', /action_validation.*Unsupported action type/],
    ['{"type":"tool","tool":"write_file","input":{"path":"a"}}', /Unsupported tool name/],
    ['{"type":"tool","tool":"read_file","input":{}}', /input.path must be a string/],
    ['{"type":"tool","tool":"read_file","input":{"path":42}}', /input.path must be a string/],
    ['{"type":"tool","tool":"read_file","input":{"path":" "}}', /must not be empty/],
    ['{"type":"tool","tool":"read_file","input":{"path":"/etc/passwd"}}', /Absolute paths/],
    ['{"type":"final","answer":42}', /Final action requires/],
    ["null", /must be a JSON object/],
    ["[]", /must be a JSON object/],
  ]) {
    assert.throws(() => parseAgentAction(text), (error) => {
      assert.match(error.message, reason);
      assert.match(error.message, /output:/);
      assert.ok(error.cause instanceof Error);
      return true;
    });
  }
  assert.throws(() => parseAgentAction("x".repeat(100_000)), (error) => {
    assert.match(error.message, /truncated/);
    assert.ok(error.message.length < 1000);
    return true;
  });
});

function mockModel(outputs) {
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const content = outputs[requests.length - 1];
    assert.ok(content !== undefined, "Unexpected extra Model request");
    return new Response(JSON.stringify({ message: { content }, done: true }) + "\n");
  };
  return requests;
}

test("Core returns structured trace, stays silent and preserves observations in both tool orders", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const read = { type: "tool", tool: "read_file", input: { path: "src/index.ts" } };
  const list = { type: "tool", tool: "list_files", input: { path: "." } };
  const final = { type: "final", answer: "Model final answer" };
  try {
    console.log = () => { throw new Error("Core must not format CLI output"); };
    for (const sequence of [[read, list, final], [list, read, final]]) {
      const requests = mockModel(sequence.map((action) => JSON.stringify(action)));
      const emitted = [];
      const result = await runAgent("Question", (entry) => emitted.push(entry));
      assert.equal(result.answer, final.answer);
      assert.deepEqual(result.trace, emitted);
      assert.deepEqual(result.trace.map((entry) => entry.iteration), [1, 2, 3]);
      assert.deepEqual(result.trace.map((entry) => entry.type), ["tool", "tool", "final"]);
      assert.deepEqual(result.trace.slice(0, 2).map((entry) => entry.status), ["success", "success"]);
      assert.deepEqual(requests.map((request) => request.messages.length), [2, 4, 6]);
      assert.ok(requests.every((request) => request.format === "json"));
      assert.ok(requests.every((request) => request.think === true && request.stream === true));
      assert.deepEqual(requests[0].messages[1], { role: "user", content: "Question" });
      for (let index = 0; index < 2; index++) {
        const history = requests[index + 1].messages;
        assert.deepEqual(history.slice(0, requests[index].messages.length), requests[index].messages);
        assert.equal(history.at(-2).content, JSON.stringify(sequence[index]));
        assert.equal(history.at(-1).role, "user");
        assert.match(history.at(-1).content, /OBSERVATION/);
        if (sequence[index].tool === "read_file") {
          assert.ok(history.at(-1).content.endsWith(readFileSync("example-repo/src/index.ts", "utf-8")));
        } else {
          const listing = JSON.parse(history.at(-1).content.split("\n").slice(1).join("\n"));
          assert.ok(listing.some((entry) => entry.name === "src" && entry.type === "directory"));
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test("Tool failures retain trace, tool, path, category and original cause", async () => {
  const originalFetch = globalThis.fetch;
  try {
    mockModel([JSON.stringify({ type: "tool", tool: "read_file", input: { path: "../package.json" } })]);
    await assert.rejects(() => runAgent("Boundary test"), (error) => {
      assert.ok(error instanceof AgentExecutionError);
      assert.match(error.message, /Tool read_file failed for path "\.\.\/package.json".*workspace_boundary/);
      assert.ok(error.cause instanceof Error);
      assert.deepEqual(error.trace.at(-1).input, { path: "../package.json" });
      assert.equal(error.trace.at(-1).status, "failure");
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("Model and action errors retain their layer and failure trace", async () => {
  const originalFetch = globalThis.fetch;
  try {
    mockModel(["not JSON"]);
    await assert.rejects(() => runAgent("Invalid action"), (error) => {
      assert.ok(error instanceof AgentExecutionError);
      assert.equal(error.trace.at(-1).layer, "action");
      assert.match(error.message, /model_json.*output: "not JSON"/);
      return true;
    });
    globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
    await assert.rejects(() => runAgent("Model unavailable"), (error) => {
      assert.equal(error.trace.at(-1).layer, "model");
      assert.match(error.message, /HTTP 503/);
      assert.ok(error.cause instanceof Error);
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("8-call iteration limit remains effective and visible in trace", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const requests = mockModel(Array(8).fill(JSON.stringify({ type: "tool", tool: "list_files", input: { path: "." } })));
    await assert.rejects(() => runAgent("Limit test"), (error) => {
      assert.match(error.message, /exceeded maximum iterations \(8\)/);
      assert.equal(requests.length, 8);
      assert.equal(error.trace.length, 9);
      assert.equal(error.trace.at(-1).layer, "iteration_limit");
      return true;
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("CLI renders Tool failure context without a raw stack trace and exits with code 1", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const originalArgs = process.argv;
  const originalExitCode = process.exitCode;
  const output = [];
  const errors = [];
  try {
    mockModel([JSON.stringify({ type: "tool", tool: "read_file", input: { path: "../package.json" } })]);
    console.log = (...args) => output.push(args.join(" "));
    console.error = (...args) => errors.push(args.join(" "));
    process.argv = [process.execPath, "src/index.ts", "Boundary test"];
    await import("../src/index.ts");
    assert.equal(process.exitCode, 1);
    assert.match(output.join("\n"), /read_file.*failure/);
    assert.match(errors.join("\n"), /Tool read_file failed.*package.json.*workspace_boundary/);
    assert.doesNotMatch(errors.join("\n"), /at runAgent|at resolveWorkspacePath/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    process.argv = originalArgs;
    process.exitCode = originalExitCode;
  }
});
