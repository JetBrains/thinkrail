/**
 * Shared store seed for the Context Panel section stories.
 *
 * These sections read the *selected spec* and the *spec graph* from specStore
 * (via useSelectedSpec). Seeding via seedSpecContext() — called per-render from
 * each section story's beforeEach — keeps the data coherent across them: a
 * selected "Agent Runner" module with a parent, two implementing tasks, a
 * reference, and coverage patterns.
 *
 * Underscore-prefixed filename keeps it out of the *.stories glob.
 */
import { useSpecStore } from "@/store/specStore.ts";
import type { SpecEntry, SpecGraph } from "@/types/spec.ts";

function s(id: string, type: string, status: string, title: string, extra: Partial<SpecEntry> = {}): SpecEntry {
  return { id, type, status, title, path: `${id}.md`, covers: [], tags: [], created: "", updated: "", ...extra };
}

const SELECTED = s("agent-runner", "module-design", "active", "Agent Runner", {
  covers: ["backend/app/agent/", "backend/app/agent/runner.py"],
  created: "2026-05-01T10:00:00Z",
  updated: "2026-05-28T16:30:00Z",
});

const SPECS: SpecEntry[] = [
  SELECTED,
  s("architecture", "architecture-design", "active", "System Architecture"),
  s("spec-index", "module-design", "active", "Spec Index"),
  s("task-runner", "task-spec", "active", "Implement runner loop"),
  s("task-events", "task-spec", "done", "Stream agent events"),
];

const GRAPH: SpecGraph = {
  nodes: SPECS,
  edges: [
    { from: "agent-runner", to: "architecture", type: "parent" },
    { from: "task-runner", to: "agent-runner", type: "implements" },
    { from: "task-events", to: "agent-runner", type: "implements" },
    { from: "agent-runner", to: "spec-index", type: "references" },
  ],
  documents: [],
};

export function seedSpecContext() {
  useSpecStore.setState({ specs: SPECS, graph: GRAPH, selectedSpecId: "agent-runner" });
}
