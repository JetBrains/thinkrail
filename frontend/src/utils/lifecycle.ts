import type { WorkNode } from "@/types/board.ts";
import { TicketLifecycle, NodeStatus, isNodeStarted, isNodeTerminal } from "@/constants/status.ts";

export function deriveLifecycle(stages: WorkNode[]): TicketLifecycle {
  if (!stages || stages.length === 0) return TicketLifecycle.Created;
  const impl = stages.find((n) => n.executesPlan) ?? null;
  const terminal = stages[stages.length - 1];
  const done = (n: WorkNode) => isNodeTerminal(n.status);
  if (
    terminal.status === NodeStatus.Done ||
    (impl != null && impl.status === NodeStatus.Done && stages.every(done))
  ) {
    return TicketLifecycle.Done;
  }
  if (impl != null && isNodeStarted(impl.status)) {
    return TicketLifecycle.Implementation;
  }
  if (stages.some((n) => isNodeStarted(n.status))) {
    return TicketLifecycle.Design;
  }
  return TicketLifecycle.Created;
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
