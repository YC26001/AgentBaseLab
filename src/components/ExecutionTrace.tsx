"use client";

import { useId, useState } from "react";
import { useAutoFollow } from "../agent/use-auto-follow";
import { IterationGroup } from "./IterationGroup";
import { StatusBadge } from "./StatusBadge";
import type { ExecutionStatus, IterationView } from "./view-types";
import styles from "./Workspace.module.css";

export function ExecutionTrace({
  iterations,
  status,
}: {
  iterations: readonly IterationView[];
  status: ExecutionStatus;
}) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  const contentId = `${id}-content`;
  const { anchorRef, following, resume } = useAutoFollow(iterations, expanded && status === "running");

  return (
    <section className={styles.trace} aria-labelledby={`${id}-heading`}>
      <div className={styles.traceHeading}>
        <h2 id={`${id}-heading`}>
          <button
            type="button"
            className={styles.traceToggle}
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className={styles.chevron} data-expanded={expanded} aria-hidden="true">
              ›
            </span>
            執行軌跡
            <span className={styles.iterationCount}>
              {iterations.length} 輪
            </span>
          </button>
        </h2>
        <div role="status">
          <StatusBadge status={status} />
        </div>
      </div>
      {/* Keep disclosures mounted when hidden so user choices survive collapse. */}
      <div id={contentId} hidden={!expanded}>
        <ol className={styles.iterationList}>
          {iterations.map((iteration, index) => (
            <IterationGroup
              key={iteration.number}
              iteration={iteration}
              active={status === "running" && index === iterations.length - 1}
            />
          ))}
        </ol>
        {status === "running" && !following && (
          <button type="button" className={`${styles.disclosureButton} ${styles.followButton}`} onClick={resume}>
            回到最新執行位置 <span aria-hidden="true">↓</span>
          </button>
        )}
        <div ref={anchorRef} className={styles.latestExecution} data-latest-execution="" />
      </div>
    </section>
  );
}
