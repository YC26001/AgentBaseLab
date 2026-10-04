import { getAgentRunUrl } from "./config";
import { parseCoreEvent, type CoreExecutionEvent } from "./core-events";

export class CoreHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "CoreHttpError";
  }
}

export class CoreStreamError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CoreStreamError";
  }
}

// Accommodates a fully JSON-escaped, bounded Core observation while rejecting
// an indefinitely growing record. This is a client buffer limit, not a Core limit.
const maxRecordCharacters = 1024 * 1024;

function parseLine(line: string): CoreExecutionEvent {
  if (line.length > maxRecordCharacters) {
    throw new CoreStreamError("Core 串流中的單筆資料過大。");
  }
  try {
    return parseCoreEvent(JSON.parse(line));
  } catch (cause) {
    throw new CoreStreamError("Core 串流包含無效的 JSON 或 execution event。", { cause });
  }
}

/** Network chunks may split either a UTF-8 character or an NDJSON record. */
export async function consumeCoreStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: CoreExecutionEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let terminal = false;
  let eof = false;

  function drainLines() {
    let newline: number;
    while (!terminal && (newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line) continue;
      const event = parseLine(line);
      onEvent(event);
      terminal = event.type === "final" || event.type === "error";
    }
    if (!terminal && pending.length > maxRecordCharacters) {
      throw new CoreStreamError("Core 串流中的單筆資料過大。");
    }
  }

  try {
    while (!terminal) {
      const chunk = await reader.read();
      if (chunk.done) {
        eof = true;
        pending += decoder.decode();
        drainLines();
        // Phase 5B requires newline-terminated records. Never parse a partial EOF.
        if (!terminal) {
          throw new CoreStreamError(pending.trim()
            ? "Core 串流在完整 NDJSON 記錄送達前中斷。"
            : "Core 串流已結束，但未收到 final 或 error。");
        }
        break;
      }
      pending += decoder.decode(chunk.value, { stream: true });
      drainLines();
    }
  } catch (cause) {
    if (cause instanceof CoreStreamError) throw cause;
    throw new CoreStreamError("讀取 Core 串流失敗，無法確認執行結果。", { cause });
  } finally {
    // A terminal event is sufficient. Do not wait for another read, EOF, or done.
    if (!eof) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function httpError(response: Response): Promise<CoreHttpError> {
  let message = `Core 回傳 HTTP ${response.status}。`;
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json") {
    try {
      const payload: unknown = await response.json();
      if (typeof payload === "object" && payload !== null && "error" in payload
        && typeof payload.error === "object" && payload.error !== null
        && "message" in payload.error && typeof payload.error.message === "string") {
        message = payload.error.message;
      }
    } catch {
      // Keep status classification even if a proxy sends a malformed error body.
    }
  }
  return new CoreHttpError(response.status, message);
}

export async function runAgentRequest({
  question,
  signal,
  onAccepted,
  onEvent,
}: {
  question: string;
  signal: AbortSignal;
  onAccepted: () => void;
  onEvent: (event: CoreExecutionEvent) => void;
}): Promise<void> {
  const response = await fetch(getAgentRunUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ question }),
    signal,
    cache: "no-store",
  });
  if (response.status !== 200) throw await httpError(response);
  // Core has accepted execution, even if transport validation subsequently fails.
  onAccepted();
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/x-ndjson" || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new CoreStreamError("Core 未提供預期的 NDJSON 串流。");
  }
  await consumeCoreStream(response.body, onEvent);
}
