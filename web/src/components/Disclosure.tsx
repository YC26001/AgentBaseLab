"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./Workspace.module.css";

export function Disclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  return (
    <div className={styles.disclosure}>
      <button
        type="button"
        className={styles.disclosureButton}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={styles.chevron} data-expanded={expanded} aria-hidden="true">
          ›
        </span>
        {label}
      </button>
      <div id={panelId} className={styles.disclosureContent} hidden={!expanded}>
        {children}
      </div>
    </div>
  );
}
