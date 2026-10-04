import type { AgentAction } from "./action.js";
import type { StructuredObservation } from "./observation.js";

type ToolAction = Extract<AgentAction, { type: "tool" }>;

export type AgentExecutionEvent =
  | { type: "iteration_started"; iteration: number }
  | { type: "model_thinking_delta"; iteration: number; delta: string }
  | {
      type: "tool_started";
      iteration: number;
      tool: ToolAction["tool"];
      input: ToolAction["input"];
    }
  | {
      type: "tool_completed";
      iteration: number;
      tool: ToolAction["tool"];
      input: ToolAction["input"];
      observation: StructuredObservation;
    }
  | { type: "final"; iteration: number; answer: string }
  | {
      type: "error";
      iteration: number;
      layer: "model" | "action" | "tool" | "iteration_limit";
      error: string;
    };
