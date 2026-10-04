import { useId } from "react";
import { Disclosure } from "./Disclosure";
import type { ErrorResultView, FinalAnswerView } from "./view-types";
import styles from "./Workspace.module.css";

export function Result({
  question,
  result,
}: {
  question: string;
  result: FinalAnswerView | ErrorResultView;
}) {
  const id = useId();
  if (result.kind === "final" && !result.answer.trim()) return null;

  return (
    <section
      className={`${styles.result} ${result.kind === "error" ? styles.errorResult : ""}`}
      aria-labelledby={`${id}-heading`}
    >
      <p className={styles.stepLabel}>執行結果</p>
      <h2 id={`${id}-heading`}>{result.kind === "final" ? "最終回答" : "錯誤結果"}</h2>
      <div className={styles.resultQuestion}>
        <h3>問題</h3>
        <p>{question}</p>
      </div>
      {result.kind === "final" ? (
        <>
          <h3 className={styles.resultSubheading}>回答</h3>
          <p className={styles.answerText}>{result.answer}</p>
          {result.filesInspected.length > 0 && (
            <div className={styles.inspectedFiles}>
              <h3 className={styles.resultSubheading}>已檢視的檔案</h3>
              <ul className={styles.fileList}>
                {result.filesInspected.map((file) => (
                  <li key={file}><code>{file}</code></li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <>
          <h3 className={styles.terminationHeading}>{result.heading ?? "執行已終止"}</h3>
          <p className={styles.errorMessage}>{result.message}</p>
          {result.explanation && <p className={styles.errorExplanation}>{result.explanation}</p>}
          {result.technicalDetails && (
            <Disclosure label="技術細節">
              <pre className={styles.codeBlock} tabIndex={0} aria-label="執行錯誤細節">
                {result.technicalDetails}
              </pre>
            </Disclosure>
          )}
        </>
      )}
    </section>
  );
}
