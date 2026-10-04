"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import styles from "./Workspace.module.css";

const recommendedQuestions = [
  "這個 Repository 主要在做什麼？",
  "這個專案實際會輸出什麼內容？",
  "哪些檔案定義了主要行為？",
] as const;

type QuestionFormProps = {
  availability: "pending" | "ready" | "busy";
  running: boolean;
  submitting?: boolean;
  notice?: string;
  onRun?: (question: string) => void;
};

export function QuestionForm({
  availability,
  running,
  submitting = false,
  notice,
  onRun,
}: QuestionFormProps) {
  const [question, setQuestion] = useState("");
  const id = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = `${id}-question`;
  const helpId = `${id}-help`;
  const locked = submitting || running || availability === "busy";
  const integrationPending = availability === "pending" || !onRun;
  const canRun = !locked && !integrationPending && question.trim().length > 0;
  const help = notice ?? (
    submitting
      ? "正在連線 Agent Core…"
      : running
        ? "Agent 執行中，可在下方查看執行軌跡。"
        : availability === "busy"
          ? "Agent 忙碌中，請等候目前的執行結束。"
          : integrationPending
            ? "目前尚未開放即時執行，你可以先準備問題。"
            : undefined
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canRun && onRun) onRun(question.trim());
  }

  return (
    <section className={styles.questionPanel} aria-labelledby={`${id}-heading`}>
      <div className={styles.sectionHeading}>
        <h2 id={`${id}-heading`}>問題</h2>
      </div>
      <form onSubmit={submit}>
        <p className={styles.fieldCaption}>推薦問題</p>
        <div className={styles.chips} role="group" aria-label="推薦問題">
          {recommendedQuestions.map((recommended) => (
            <button
              key={recommended}
              type="button"
              className={styles.chip}
              disabled={locked}
              aria-pressed={question === recommended}
              onClick={() => {
                setQuestion(recommended);
                inputRef.current?.focus();
              }}
            >
              {recommended}
            </button>
          ))}
        </div>
        <label className={styles.inputLabel} htmlFor={inputId}>
          你的問題
        </label>
        <textarea
          ref={inputRef}
          id={inputId}
          name="question"
          className={styles.questionInput}
          rows={3}
          placeholder="輸入你想了解的問題，Agent 會使用唯讀工具分析固定的示範 Repository"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          aria-describedby={help ? helpId : undefined}
          disabled={locked}
          required
        />
        <div className={styles.formFooter}>
          {help && (
            <p id={helpId} className={styles.formHelp} role="status">
              {help}
            </p>
          )}
          <button
            type="submit"
            className={styles.runButton}
            disabled={!canRun}
            aria-describedby={help ? helpId : undefined}
          >
            執行 Agent <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </section>
  );
}
