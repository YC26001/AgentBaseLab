/** Presentation props only. These are not the Core API or streaming contract. */
export type ExecutionStatus = "running" | "success" | "error";

export type ThinkingView = {
  text: string;
  truncated?: boolean;
};

export type ToolCallView = {
  name: "list_files" | "read_file";
  path: string;
  status: ExecutionStatus;
  technicalDetails?: string;
};

export type ObservationView =
  | {
      kind: "list_files";
      count: number;
      entries: readonly { name: string; type: "file" | "directory" }[];
      truncated?: boolean;
    }
  | {
      kind: "read_file";
      bytes: number;
      lines: number;
      excerpt: string;
      truncated?: boolean;
    };

export type IterationView = {
  number: number;
  thinking?: ThinkingView;
  toolCall?: ToolCallView;
  observation?: ObservationView;
  error?: string;
  // Supply only after the subsequent action is known; do not predict it.
  handoff?: "next-tool" | "final";
};

export type FinalAnswerView = {
  kind: "final";
  answer: string;
  filesInspected: readonly string[];
};

export type ErrorResultView = {
  kind: "error";
  message: string;
  explanation?: string;
  technicalDetails?: string;
};

type RunContent = {
  /** Stable within a run, different for every new run. Resets disclosure state. */
  id: string;
  question: string;
  iterations: readonly IterationView[];
};

export type RunViewState =
  | { status: "idle" }
  | (RunContent & { status: "running" })
  | (RunContent & { status: "success"; result: FinalAnswerView })
  | (RunContent & { status: "error"; result: ErrorResultView });
