export type ExecutionTraceEntry =
  | {
      iteration: number;
      type: "tool";
      tool: "list_files" | "read_file";
      input: { path: string };
      status: "success" | "failure";
      error?: string;
    }
  | { iteration: number; type: "final" }
  | {
      iteration: number;
      type: "error";
      layer: "model" | "action" | "iteration_limit";
      error: string;
    };

export type AgentResult = {
  answer: string;
  trace: ExecutionTraceEntry[];
};

// Preserve the steps completed before a fail-fast error for programmatic callers.
export class AgentExecutionError extends Error {
  constructor(
    message: string,
    public readonly trace: ExecutionTraceEntry[],
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "AgentExecutionError";
  }
}
