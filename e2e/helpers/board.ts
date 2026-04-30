/**
 * Helpers for seeding meta-tickets, plans, and spec drafts directly to the
 * temp project's `.bonsai/` directory so board specs don't need an LLM call
 * to put the system into a non-trivial state.
 *
 * The shapes mirror what the Python backend writes — we keep them in sync
 * with `backend/app/board/models.py`, `backend/app/board/plan.py`, and
 * `backend/app/board/spec_drafts.py`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SeedTicketOpts {
  id?: string;
  title: string;
  body?: string;
  status?: "idea" | "described" | "specified" | "planned" | "executing" | "done";
  type?: "feature" | "bug" | "idea" | "improvement";
  order?: number;
  linkedSpecIds?: string[];
  sessionIds?: string[];
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
 * Write a meta-ticket JSON file under `.bonsai/meta-tickets/`. Returns the
 * generated ticket id.
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
    orchestratorSessionId: null,
    linkedSpecIds: opts.linkedSpecIds ?? [],
    sessionIds: opts.sessionIds ?? [],
    specPatches: [],
    order: opts.order ?? 0,
    created: nowIso(),
    updated: nowIso(),
  };
  const dir = join(projectPath, ".bonsai", "meta-tickets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(ticket, null, 2) + "\n", "utf8");
  return id;
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
 * Write a plan markdown file under `.bonsai/plans/{ticketId}.md` matching the
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

  const planRel = `.bonsai/plans/${opts.ticketId}.md`;
  const planPath = join(projectPath, planRel);
  mkdirSync(join(planPath, ".."), { recursive: true });
  writeFileSync(planPath, lines.join("\n"), "utf8");
  return planRel;
}

export interface SeedTrashedPlanOpts {
  ticketId: string;
  body?: string;
}

/**
 * Seed a trashed plan directly into `.bonsai/trash/plans/<ticketId>/`.
 * Mirrors what `TrashService.trash_plan` writes — used so trash specs can
 * exercise restore without first running the delete RPC.
 */
export function seedTrashedPlan(
  projectPath: string,
  opts: SeedTrashedPlanOpts,
): void {
  const trashDir = join(
    projectPath,
    ".bonsai",
    "trash",
    "plans",
    opts.ticketId,
  );
  mkdirSync(trashDir, { recursive: true });
  writeFileSync(
    join(trashDir, `${opts.ticketId}.md`),
    opts.body ?? `# Trashed plan ${opts.ticketId}\n\nBody.\n`,
    "utf8",
  );
  const sidecar = {
    trashedAt: nowIso(),
    originalDir: join(projectPath, ".bonsai", "plans"),
    type: "plans",
    context: { ticketId: opts.ticketId },
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
 * Write a draft manifest + draft files under `.bonsai/spec-drafts/{ticketId}/`.
 * Each entry is a draft change waiting to be applied.
 */
export function seedDrafts(
  projectPath: string,
  ticketId: string,
  entries: SeedDraftEntry[],
): void {
  const ticketDir = join(projectPath, ".bonsai", "spec-drafts", ticketId);
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
