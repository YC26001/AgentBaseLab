export type AgentAction =
  | {
      type: "final";
      answer: string;
    }
  | {
      type: "tool";
      tool: "list_files" | "read_file";
      input: { path: string };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAgentAction(text: string): AgentAction {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error("Model output is not valid JSON", { cause: error });
  }

  if (!isRecord(value)) {
    throw new Error("Agent action must be a JSON object");
  }

  if (value.type === "final") {
    if (typeof value.answer !== "string" || value.answer.trim().length === 0) {
      throw new Error("Final action requires a non-empty string answer");
    }

    return { type: "final", answer: value.answer };
  }

  if (value.type !== "tool") {
    throw new Error(`Unsupported action type: ${String(value.type)}`);
  }

  if (value.tool !== "list_files" && value.tool !== "read_file") {
    throw new Error(`Unsupported tool name: ${String(value.tool)}`);
  }

  if (
    !isRecord(value.input) ||
    typeof value.input.path !== "string" ||
    value.input.path.trim().length === 0
  ) {
    throw new Error("Tool action requires input.path as a non-empty string");
  }

  return {
    type: "tool",
    tool: value.tool,
    input: { path: value.input.path },
  };
}
