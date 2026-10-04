/** Mirrors Phase 5B Core events; no Core runtime code is imported into Web. */
export type CoreObservation =
  | {
      type: "list_files";
      path: string;
      count: number;
      entries: { name: string; type: "file" | "directory" }[];
    }
  | {
      type: "read_file";
      path: string;
      bytes: number;
      lines: number;
      content: string;
    };

type ToolEvent = {
  iteration: number;
  tool: "list_files" | "read_file";
  input: { path: string };
};

export type CoreExecutionEvent =
  | { type: "iteration_started"; iteration: number }
  | { type: "model_thinking_delta"; iteration: number; delta: string }
  | (ToolEvent & { type: "tool_started" })
  | (ToolEvent & { type: "tool_completed"; observation: CoreObservation })
  | { type: "final"; iteration: number; answer: string }
  | {
      type: "error";
      iteration: number;
      layer: "model" | "action" | "tool" | "iteration_limit";
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isObservation(value: unknown): value is CoreObservation {
  if (!isRecord(value) || typeof value.path !== "string") return false;
  if (value.type === "read_file") {
    return isCount(value.bytes) && isCount(value.lines) && typeof value.content === "string";
  }
  return value.type === "list_files" && isCount(value.count) && Array.isArray(value.entries)
    && value.entries.every((entry: unknown) => isRecord(entry)
      && typeof entry.name === "string"
      && (entry.type === "file" || entry.type === "directory"));
}

/** Validate the network boundary before passing data into presentation state. */
export function parseCoreEvent(value: unknown): CoreExecutionEvent {
  let valid = false;
  if (isRecord(value) && isCount(value.iteration) && value.iteration > 0) {
    switch (value.type) {
      case "iteration_started":
        valid = true;
        break;
      case "model_thinking_delta":
        valid = typeof value.delta === "string";
        break;
      case "final":
        valid = typeof value.answer === "string" && value.answer.trim().length > 0;
        break;
      case "error":
        valid = typeof value.error === "string" && value.error.length > 0
          && typeof value.layer === "string"
          && ["model", "action", "tool", "iteration_limit"].includes(value.layer);
        break;
      case "tool_started":
      case "tool_completed":
        valid = (value.tool === "read_file" || value.tool === "list_files")
          && isRecord(value.input) && typeof value.input.path === "string";
        if (valid && value.type === "tool_completed") {
          valid = isObservation(value.observation)
            && value.observation.type === value.tool
            && isRecord(value.input) && value.observation.path === value.input.path;
        }
        break;
    }
  }
  if (!valid) throw new Error("Core 回傳的 execution event 格式不符正式 contract。");
  return value as CoreExecutionEvent;
}
