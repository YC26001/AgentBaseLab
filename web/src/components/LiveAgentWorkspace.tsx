"use client";

import { useAgentRun } from "../agent/use-agent-run";
import { AgentWorkspace } from "./AgentWorkspace";

export function LiveAgentWorkspace() {
  const { run, submitting, notice, onRun } = useAgentRun();
  return (
    <AgentWorkspace
      run={run}
      availability="ready"
      submitting={submitting}
      notice={notice}
      onRun={onRun}
    />
  );
}
