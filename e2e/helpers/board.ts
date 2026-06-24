/**
 * Helpers for seeding meta-tickets, plans, spec drafts, and sessions directly
 * to the temp project's `.tr/` directory so board specs don't need an LLM call
 * to put the system into a non-trivial state.
 *
 * The shapes mirror what the Python backend writes — we keep them in sync
 * with `backend/app/board/models.py`, `backend/app/board/plan.py`,
 * `backend/app/board/spec_drafts.py`, and `backend/app/agent/persistence.py`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SeedTicketOpts {
  id?: string;
  title: string;
  body?: string;
  status?:
    | "idea"
    | "product-design"
    | "technical-design"
    | "amend-specs"
    | "implementation-plan"
    | "implementing"
    | "done";
  type?: "feature" | "bug" | "idea" | "improvement";
  order?: number;
  linkedSpecIds?: string[];
  sessionIds?: string[];
  /** Orchestrator session id (legacy `orchestratorSessionId` field — the
   *  backend migrates it to `orchestrator.session_id` on load). */
  orchestratorSessionId?: string | null;
  planPath?: string | null;
}

let _ticketCounter = 0;

function makeTicketId(): string {
  _ticketCounter += 1;
  return `mt_e2e${_ticketCounter.toString(16).padStart(6, "0")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Write a ticket to `.tr/tickets/{id}/ticket.json` (the per-ticket folder
 * layout the board loader walks). Returns the generated ticket id.
 */
export function seedTicket(projectPath: string, opts: SeedTicketOpts): string {
  const id = opts.id ?? makeTicketId();
  const ticket = {
    id,
    title: opts.title,
    body: opts.body ?? "",
    status: opts.status ?? "idea",
    type: opts.type ?? "feature",
    planPath: opts.planPath ?? null,
    orchestratorSessionId: opts.orchestratorSessionId ?? null,
    linkedSpecIds: opts.linkedSpecIds ?? [],
    sessionIds: opts.sessionIds ?? [],
    specPatches: [],
    order: opts.order ?? 0,
    created: nowIso(),
    updated: nowIso(),
  };
  const dir = join(projectPath, ".tr", "tickets", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ticket.json"), JSON.stringify(ticket, null, 2) + "\n", "utf8");
  return id;
}

/**
 * Write a non-empty design-doc deliverable at `.tr/DESIGN_DOC.md`. The backend
 * classifies a project holding a later spec deliverable (or a ticket) as
 * "initialized", so the picker opens straight into the workspace rather than
 * the onboarding wizard. Use when a spec needs the workspace but no ticket.
 *
 * Note: the spec indexer picks this file up as an unmanaged document, so it
 * shows in the SpecTree's documents list — don't use it in specs that assert
 * an empty SpecTree (seed a `seedTicket` for those instead).
 */
export function seedDeliverable(projectPath: string): void {
  const dir = join(projectPath, ".tr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "DESIGN_DOC.md"),
    "# Design Doc\n\nSeeded e2e deliverable.\n",
    "utf8",
  );
}

export interface SeedSessionOpts {
  id: string;
  name?: string;
  ticketId?: string | null;
  status?: "done" | "error" | "idle" | "running" | "draft";
  model?: string;
  skillId?: string | null;
}

/**
 * Write a session to `.tr/sessions/{id}.json` (+ an empty `.events.jsonl`),
 * matching the metadata shape `app/agent/persistence.py` reads. Returns the id.
 */
export function seedSession(projectPath: string, opts: SeedSessionOpts): string {
  const sid = opts.id;
  const meta = {
    thinkrailSid: sid,
    name: opts.name ?? sid,
    skillId: opts.skillId ?? null,
    specIds: [],
    status: opts.status ?? "done",
    config: { model: opts.model ?? "claude-sonnet-4-6" },
    ticketId: opts.ticketId ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    metrics: {},
  };
  const dir = join(projectPath, ".tr", "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sid}.json`), JSON.stringify(meta, null, 2) + "\n", "utf8");
  writeFileSync(join(dir, `${sid}.events.jsonl`), "", "utf8");
  return sid;
}

export interface SeedPlanStep {
  number: number;
  title: string;
  status?: "pending" | "executing" | "done" | "failed";
  skill?: string;
  agentInstructions?: string;
  successCriteria?: { text: string; checked: boolean }[];
}

export interface SeedPlanOpts {
  ticketId: string;
  title: string;
  steps: SeedPlanStep[];
  status?: "draft" | "ready" | "executing" | "done";
  verification?: { text: string; checked: boolean }[];
}

/**
 * Write a plan markdown file under `.tr/plans/{ticketId}.md` matching the
 * plan parser's milestone format. Returns the path written (relative to the
 * project root).
 */
export function seedPlan(projectPath: string, opts: SeedPlanOpts): string {
  const lines: string[] = [];
  lines.push(`# Plan: ${opts.title}`);
  lines.push("");
  lines.push("## Meta");
  lines.push(`- **Ticket:** ${opts.ticketId}`);
  lines.push(`- **Status:** ${opts.status ?? "draft"}`);
  lines.push(`- **Updated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push("## Milestone 1: Implementation");
  for (const step of opts.steps) {
    lines.push("");
    lines.push(`### Step ${step.number}: ${step.title}`);
    lines.push(`- **Status:** ${step.status ?? "pending"}`);
    lines.push(`- **Skill:** ${step.skill ?? "default"}`);
    if (step.agentInstructions) {
      lines.push(`- **Agent instructions:** ${step.agentInstructions}`);
    }
    if (step.successCriteria && step.successCriteria.length > 0) {
      lines.push("- **Success criteria:**");
      for (const c of step.successCriteria) {
        const check = c.checked ? "x" : " ";
        lines.push(`  - [${check}] ${c.text}`);
      }
    }
  }
  if (opts.verification && opts.verification.length > 0) {
    lines.push("");
    lines.push("## Verification");
    for (const c of opts.verification) {
      const check = c.checked ? "x" : " ";
      lines.push(`- [${check}] ${c.text}`);
    }
  }
  lines.push("");

  const planRel = `.tr/plans/${opts.ticketId}.md`;
  const planPath = join(projectPath, planRel);
  mkdirSync(join(planPath, ".."), { recursive: true });
  writeFileSync(planPath, lines.join("\n"), "utf8");
  return planRel;
}

export interface SeedTrashedSpecOpts {
  specId: string;
  /** Path relative to project root, e.g. "specs/example.md". */
  relPath?: string;
  content?: string;
}

/**
 * Seed a trashed spec into `.tr/trash/specs/<specId>/`. Mirrors
 * TrashService.trash_spec — restore (the only wired trash-restore RPC) moves
 * the file back to originalDir and re-inserts the registry entry.
 */
export function seedTrashedSpec(
  projectPath: string,
  opts: SeedTrashedSpecOpts,
): void {
  const relPath = opts.relPath ?? `specs/${opts.specId}.md`;
  const segments = relPath.split("/");
  const fileName = segments[segments.length - 1];
  const originalDir = join(projectPath, ...segments.slice(0, -1));
  const trashDir = join(projectPath, ".tr", "trash", "specs", opts.specId);
  mkdirSync(trashDir, { recursive: true });
  writeFileSync(
    join(trashDir, fileName),
    opts.content ?? `# ${opts.specId}\n\nTrashed spec body.\n`,
    "utf8",
  );
  const sidecar = {
    trashedAt: nowIso(),
    originalDir,
    type: "specs",
    context: {
      registryEntry: { id: opts.specId, type: "module-design", title: opts.specId },
      links: [],
    },
  };
  writeFileSync(
    join(trashDir, "_trash.json"),
    JSON.stringify(sidecar, null, 2),
    "utf8",
  );
}

export interface SeedDraftEntry {
  /** Path relative to project root, e.g. "specs/example.md". */
  realPath: string;
  /** Full draft content (frontmatter + body) — required for create/update. */
  content?: string;
  operation?: "create" | "update" | "delete";
  registryId?: string;
  registryType?: string;
  registryTitle?: string;
}

/**
 * Write a draft manifest + draft files under `.tr/spec-drafts/{ticketId}/`.
 * Each entry is a draft change waiting to be applied.
 */
export function seedDrafts(
  projectPath: string,
  ticketId: string,
  entries: SeedDraftEntry[],
): void {
  const ticketDir = join(projectPath, ".tr", "spec-drafts", ticketId);
  mkdirSync(ticketDir, { recursive: true });

  const manifestEntries = entries.map((e) => {
    const op = e.operation ?? "create";
    if (op !== "delete") {
      const filePath = join(ticketDir, e.realPath);
      mkdirSync(join(filePath, ".."), { recursive: true });
      writeFileSync(filePath, e.content ?? "", "utf8");
    }
    return {
      operation: op,
      realPath: e.realPath,
      draftPath: op === "delete" ? "" : e.realPath,
      registryId: e.registryId ?? "",
      registryType: e.registryType ?? "module-design",
      registryTitle: e.registryTitle ?? e.realPath,
      registryCovers: [],
      registryTags: [],
      created: nowIso(),
    };
  });

  const manifest = {
    ticketId,
    sessionId: "",
    created: nowIso(),
    entries: manifestEntries,
  };
  writeFileSync(
    join(ticketDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}
