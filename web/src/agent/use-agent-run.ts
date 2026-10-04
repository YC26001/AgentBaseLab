"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunViewState } from "../components/view-types";
import { CoreHttpError, runAgentRequest } from "./core-client";
import { applyCoreEvent, createRunningRun, failRunTransport } from "./run-state";

export function useAgentRun() {
  const [run, setRun] = useState<RunViewState>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => {
    // Browser disconnect does not cancel the Core's execution.
    const request = activeRequest.current;
    activeRequest.current = null;
    request?.abort();
  }, []);

  const onRun = useCallback((question: string) => {
    if (activeRequest.current || !question.trim()) return;
    const request = new AbortController();
    activeRequest.current = request;
    const id = crypto.randomUUID();
    let current: RunViewState = { status: "idle" };
    // Clear previous trace/result before making any request.
    setRun(current);
    setNotice(undefined);
    setSubmitting(true);

    void runAgentRequest({
      question: question.trim(), signal: request.signal,
      onAccepted() {
        if (activeRequest.current !== request) return;
        current = createRunningRun(id, question.trim());
        setRun(current);
        setSubmitting(false);
      },
      onEvent(event) {
        if (activeRequest.current !== request) return;
        current = applyCoreEvent(current, event);
        // Immutable updates preserve every delta, even while Thinking is hidden.
        setRun(current);
      },
    }).catch((error: unknown) => {
      if (activeRequest.current !== request || request.signal.aborted) return;
      if (current.status === "running") {
        const message = error instanceof Error ? error.message : "Core 串流讀取失敗。";
        current = failRunTransport(current, message);
        setRun(current);
      } else if (error instanceof CoreHttpError && error.status === 409) {
        // No readiness endpoint exists. Keep retry available rather than lock UI indefinitely.
        setNotice("Agent 正在執行其他請求，請稍後再試。");
      } else if (error instanceof CoreHttpError && error.status === 400) {
        setNotice(`請求無效：${error.message}`);
      } else if (error instanceof CoreHttpError) {
        setNotice(`Core 請求失敗（HTTP ${error.status}）：${error.message}`);
      } else {
        setNotice("無法連線到 Agent Core，請確認服務、URL 與 CORS 設定後再試。");
      }
    }).finally(() => {
      if (activeRequest.current !== request) return;
      activeRequest.current = null;
      setSubmitting(false);
    });
  }, []);

  return { run, submitting, notice, onRun };
}
