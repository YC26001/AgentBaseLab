import { Disclosure } from "./Disclosure";
import type { ThinkingView } from "./view-types";
import styles from "./Workspace.module.css";

export function ThinkingPanel({
  thinking,
  generating,
}: {
  thinking?: ThinkingView;
  generating: boolean;
}) {
  if (!thinking?.text && !generating) return null;

  return (
    <div className={styles.thinking}>
      <p className={styles.stepLabel}>模型</p>
      {generating && (
        <p className={styles.secondaryText}>
          正在產生決策
          <span className={styles.loadingDots} aria-hidden="true">
            <span>.</span><span>.</span><span>.</span>
          </span>
          <span className={styles.srOnly}>...</span>
        </p>
      )}
      {thinking?.text && (
        <Disclosure label="查看模型推論">
          <pre className={styles.thinkingText} tabIndex={0} aria-label="模型推論">
            {thinking.text}
          </pre>
          {thinking.truncated && (
            <p className={styles.secondaryText}>模型推論內容已截短。</p>
          )}
        </Disclosure>
      )}
    </div>
  );
}
