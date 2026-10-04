"use client";

import { ExecutionTrace } from "./ExecutionTrace";
import { QuestionForm } from "./QuestionForm";
import { Result } from "./Result";
import type { RunViewState } from "./view-types";
import styles from "./Workspace.module.css";

type AgentWorkspaceProps = {
  run?: RunViewState;
  availability?: "pending" | "ready" | "busy";
  submitting?: boolean;
  notice?: string;
  onRun?: (question: string) => void;
};

const idleRun: RunViewState = { status: "idle" };

/**
 * Controlled UI boundary. The Core client owns run data and onRun.
 * Starting a run must replace the previous run with empty iterations and no result.
 * No transport, event parsing, or execution behavior lives here.
 */
export function AgentWorkspace({
  run = idleRun,
  availability = "pending",
  submitting = false,
  notice,
  onRun,
}: AgentWorkspaceProps) {
  return (
    <div className={styles.workspace}>
      <QuestionForm
        availability={availability}
        running={run.status === "running"}
        submitting={submitting}
        notice={notice}
        onRun={onRun}
      />
      {run.status !== "idle" && (
        <>
          <ExecutionTrace
            key={run.id}
            iterations={run.iterations}
            status={run.status}
          />
          {run.status !== "running" && (
            <Result question={run.question} result={run.result} />
          )}
        </>
      )}
    </div>
  );
}
