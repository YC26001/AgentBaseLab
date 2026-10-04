import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { runAgent } from "../agent/agent.js";
import type { AgentExecutionEvent } from "../agent/events.js";
import { AgentExecutionError } from "../agent/trace.js";
import { describeError } from "../diagnostics.js";

export const DEFAULT_WEB_ORIGIN = "http://localhost:3000";
const MAX_REQUEST_BYTES = 64 * 1024;

type ServerOptions = {
  runAgent?: typeof runAgent;
  webOrigin?: string;
};

function sendError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string
): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: { code, message } }));
}

async function readQuestion(request: IncomingMessage): Promise<string> {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new Error("Content-Type must be application/json.");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  // An invalid body must still be able to receive a JSON 400 response.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error(`Request body must not exceed ${MAX_REQUEST_BYTES} bytes.`);
    }
    chunks.push(chunk);
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
  if (
    typeof body !== "object" || body === null || Array.isArray(body) ||
    !("question" in body) || typeof body.question !== "string" ||
    body.question.trim().length === 0
  ) {
    throw new Error("question must be a non-empty string.");
  }
  return body.question.trim();
}

export function createAgentServer(options: ServerOptions = {}): Server {
  const executeAgent = options.runAgent ?? runAgent;
  const webOrigin = options.webOrigin ?? DEFAULT_WEB_ORIGIN;
  let busy = false;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.on("error", () => response.destroy());
    response.setHeader("Vary", "Origin");
    if (request.headers.origin === webOrigin) {
      response.setHeader("Access-Control-Allow-Origin", webOrigin);
    }

    if (request.url !== "/api/agent/run") {
      request.resume();
      sendError(response, 404, "NOT_FOUND", "Endpoint not found.");
      return;
    }
    if (request.method === "OPTIONS") {
      request.resume();
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      request.resume();
      response.setHeader("Allow", "POST, OPTIONS");
      sendError(response, 405, "METHOD_NOT_ALLOWED", "Use POST /api/agent/run.");
      return;
    }

    let question: string;
    try {
      question = await readQuestion(request);
    } catch (error) {
      request.resume();
      sendError(response, 400, "INVALID_REQUEST", describeError(error));
      return;
    }
    if (response.destroyed || response.writableEnded) return;
    // Check after body validation so concurrent uploads cannot both acquire a run.
    if (busy) {
      sendError(response, 409, "AGENT_BUSY", "An agent run is already in progress.");
      return;
    }
    busy = true;

    let terminalEventReceived = false;
    function onEvent(event: AgentExecutionEvent): void {
      if (event.type === "final" || event.type === "error") terminalEventReceived = true;
      if (response.destroyed || response.writableEnded) return;
      response.write(JSON.stringify(event) + "\n");
    }

    try {
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.flushHeaders();
      await executeAgent(question, undefined, onEvent);
    } catch (error) {
      if (!(error instanceof AgentExecutionError)) {
        console.error(`[http] Agent execution failed: ${describeError(error)}`);
      }
      // Core owns execution error events. Never duplicate or invent one here.
      if (!terminalEventReceived) response.destroy();
    } finally {
      busy = false;
      if (!response.destroyed && !response.writableEnded) response.end();
    }
  }

  return createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      console.error(`[http] Request failed: ${describeError(error)}`);
      response.destroy();
    });
  });
}
