import type { IterationView, RunViewState } from "../components/view-types";
import type { CoreExecutionEvent } from "./core-events";

// Matches Core's bounded thinking retention, without retaining delta history.
const maxThinkingCharacters = 16_000;

export function createRunningRun(id: string, question: string): RunViewState {
  return { status: "running", id, question, iterations: [] };
}

function handoff(
  iterations: readonly IterationView[],
  current: number,
  action: "next-tool" | "final",
): readonly IterationView[] {
  for (let index = current - 1; index >= 0; index--) {
    if (iterations[index].observation && !iterations[index].handoff) {
      return iterations.map((iteration, at) => at === index
        ? { ...iteration, handoff: action } : iteration);
    }
  }
  return iterations;
}

const errorExplanations = {
  model: "模型請求或串流失敗，本次執行已停止。",
  action: "模型回傳的動作未通過驗證，本次執行已停止。",
  tool: "工具執行失敗，本次執行已停止。",
  iteration_limit: "已達執行輪數上限，本次執行已停止。",
} as const;

/** Converts received events to existing view props; never invents execution events. */
export function applyCoreEvent(run: RunViewState, event: CoreExecutionEvent): RunViewState {
  if (run.status !== "running") return run;
  if (event.type === "iteration_started") {
    const last = run.iterations.at(-1)?.number ?? 0;
    if (event.iteration !== last + 1) throw new Error("Core 的 iteration 順序不符預期。");
    return { ...run, iterations: [...run.iterations, { number: event.iteration }] };
  }

  const index = run.iterations.findIndex((iteration) => iteration.number === event.iteration);
  if (index < 0) throw new Error("Core event 缺少對應的 iteration_started。");
  const iteration = run.iterations[index];
  let updated: IterationView = iteration;
  let iterations = run.iterations;

  switch (event.type) {
    case "model_thinking_delta": {
      const text = (iteration.thinking?.text ?? "") + event.delta;
      updated = {
        ...iteration,
        thinking: {
          text: text.slice(0, maxThinkingCharacters),
          truncated: iteration.thinking?.truncated || text.length > maxThinkingCharacters,
        },
      };
      break;
    }
    case "tool_started":
      if (iteration.toolCall) throw new Error("同一 iteration 重複收到 tool_started。");
      updated = {
        ...iteration,
        toolCall: {
          name: event.tool, path: event.input.path, status: "running",
          technicalDetails: JSON.stringify(event.input, null, 2),
        },
      };
      iterations = handoff(iterations, index, "next-tool");
      break;
    case "tool_completed": {
      const tool = iteration.toolCall;
      if (!tool || tool.status !== "running" || tool.name !== event.tool || tool.path !== event.input.path) {
        throw new Error("tool_completed 與目前的 tool_started 不一致。");
      }
      const observation = event.observation;
      updated = {
        ...iteration,
        toolCall: { ...tool, status: "success" },
        observation: observation.type === "list_files"
          ? { kind: "list_files", count: observation.count, entries: observation.entries }
          : { kind: "read_file", bytes: observation.bytes, lines: observation.lines, excerpt: observation.content },
      };
      break;
    }
    case "final": {
      const filesInspected = [...new Set(run.iterations.flatMap((item) =>
        item.toolCall?.name === "read_file" && item.toolCall.status === "success"
          ? [item.toolCall.path] : []))];
      return {
        ...run, status: "success", iterations: handoff(iterations, index, "final"),
        result: { kind: "final", answer: event.answer, filesInspected },
      };
    }
    case "error":
      updated = {
        ...iteration, error: event.error,
        toolCall: event.layer === "tool" && iteration.toolCall?.status === "running"
          ? { ...iteration.toolCall, status: "error" } : iteration.toolCall,
      };
      return {
        ...run, status: "error",
        iterations: iterations.map((item, at) => at === index ? updated : item),
        result: {
          kind: "error", message: event.error, explanation: errorExplanations[event.layer],
          technicalDetails: `layer: ${event.layer}\niteration: ${event.iteration}`,
        },
      };
  }
  return { ...run, iterations: iterations.map((item, at) => at === index ? updated : item) };
}

/** Transport failure is a UI failure, not a fabricated Core error event. */
export function failRunTransport(run: RunViewState, message: string): RunViewState {
  if (run.status !== "running") return run;
  return {
    ...run, status: "error",
    result: {
      kind: "error", heading: "無法確認執行結果", message,
      explanation: "連線或串流發生問題，Core 可能仍在執行。請確認服務狀態後再試。",
    },
  };
}
