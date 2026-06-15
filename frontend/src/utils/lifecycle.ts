import type { Lifecycle, WorkNode } from "@/types/board.ts";

export function deriveLifecycle(stages: WorkNode[]): Lifecycle {
  if (!stages || stages.length === 0) return "created";
  const impl = stages.find((n) => n.executesPlan) ?? null;
  const terminal = stages[stages.length - 1];
  const done = (n: WorkNode) => n.status === "done" || n.status === "failed";
  if (
    terminal.status === "done" ||
    (impl != null && impl.status === "done" && stages.every(done))
  ) {
    return "done";
  }
  if (impl != null && (impl.status === "running" || impl.status === "done")) {
    return "implementation";
  }
  if (stages.some((n) => n.status === "running" || n.status === "done")) {
    return "design";
  }
  return "created";
}

/** Find a node by id anywhere in the stage tree (stages or children). */
export function findStageNode(nodes: WorkNode[], id: string): WorkNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findStageNode(n.children ?? [], id);
    if (found) return found;
  }
  return null;
}

/** The session id of a node's most recent run, if any. */
export function latestNodeSessionId(node: WorkNode): string | null {
  const runs = node.runs ?? [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const sid = runs[i].sessionId ?? runs[i].orchestratorSid;
    if (sid) return sid;
  }
  return null;
}
