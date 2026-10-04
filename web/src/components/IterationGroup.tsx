import { Observation } from "./Observation";
import { ThinkingPanel } from "./ThinkingPanel";
import { ToolCall } from "./ToolCall";
import type { IterationView } from "./view-types";
import styles from "./Workspace.module.css";

export function IterationGroup({
  iteration,
  active,
}: {
  iteration: IterationView;
  active: boolean;
}) {
  const failed = Boolean(iteration.error) || iteration.toolCall?.status === "error";
  const toolFailed = iteration.toolCall?.status === "error";

  return (
    <li className={styles.iteration}>
      <h3 className={styles.iterationHeading}>
        <span className={styles.iterationNumber}>{String(iteration.number).padStart(2, "0")}</span>
        執行輪次
      </h3>
      <div className={styles.iterationBody}>
        <ThinkingPanel
          thinking={iteration.thinking}
          generating={active && !iteration.toolCall && !failed}
        />
        {iteration.toolCall && <ToolCall tool={iteration.toolCall} />}
        {iteration.toolCall && !toolFailed && (iteration.observation || !failed) && (
          <div className={styles.connector} aria-hidden="true">↓</div>
        )}
        {iteration.observation && !toolFailed ? (
          <Observation observation={iteration.observation} />
        ) : iteration.toolCall?.status === "running" && !failed ? (
          <div className={styles.observation}>
            <p className={styles.stepLabel}>觀察結果</p>
            <p className={styles.secondaryText}>等待工具執行結果</p>
          </div>
        ) : null}
        {iteration.error && (
          <div className={styles.traceError}>
            <p className={styles.stepLabel}>錯誤</p>
            <p>{iteration.error}</p>
          </div>
        )}
      </div>
      {iteration.observation && iteration.handoff && !failed && (
        <p className={styles.handoff}>
          觀察結果已回傳給 Agent。
          <br />
          {iteration.handoff === "next-tool"
            ? "Agent 選擇了下一個工具呼叫。"
            : "Agent 未再要求呼叫工具。"}
        </p>
      )}
    </li>
  );
}
