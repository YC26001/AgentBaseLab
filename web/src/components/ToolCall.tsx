import { Disclosure } from "./Disclosure";
import { StatusBadge } from "./StatusBadge";
import type { ToolCallView } from "./view-types";
import styles from "./Workspace.module.css";

export function ToolCall({ tool }: { tool: ToolCallView }) {
  return (
    <div className={styles.toolCall}>
      <p className={styles.stepLabel}>工具呼叫</p>
      <div className={styles.toolHeading}>
        <code className={styles.toolName}>{tool.name}</code>
        <StatusBadge status={tool.status} />
      </div>
      <p className={styles.toolPath}>{tool.path}</p>
      {tool.technicalDetails && (
        <Disclosure label="技術細節">
          <pre className={styles.codeBlock} tabIndex={0} aria-label="工具呼叫細節">
            {tool.technicalDetails}
          </pre>
        </Disclosure>
      )}
    </div>
  );
}
