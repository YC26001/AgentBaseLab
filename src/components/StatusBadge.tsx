import type { ExecutionStatus } from "./view-types";
import styles from "./Workspace.module.css";

const labels: Record<ExecutionStatus, string> = {
  running: "執行中",
  success: "成功",
  error: "錯誤",
};

export function StatusBadge({ status }: { status: ExecutionStatus }) {
  return (
    <span className={styles.statusBadge} data-status={status}>
      <span className={styles.statusDot} aria-hidden="true" />
      {labels[status]}
    </span>
  );
}
