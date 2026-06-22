import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AgentEvent = {
  thinkrailSid: string;
  sessionId?: string;
  eventType: string;
  payload: Record<string, unknown>;
};

export interface SeedArchivedSessionOpts {
  thinkrailSid?: string;
  name: string;
  skillId?: string | null;
  status?: "done" | "error" | "idle" | "interrupted";
  events: AgentEvent[];
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Seed a persisted session directly into `.tr/sessions/`.
 *
 * This mirrors backend/app/agent/persistence.py's on-disk layout and lets e2e
 * specs exercise restored chat rendering without making a real LLM call.
 */
export function seedArchivedSession(
  projectPath: string,
  opts: SeedArchivedSessionOpts,
): string {
  const thinkrailSid = opts.thinkrailSid ?? `e2e-${Date.now().toString(36)}`;
  const sessionId = opts.events[0]?.sessionId ?? `sdk-${thinkrailSid}`;
  const timestamp = nowIso();
  const sessionsDir = join(projectPath, ".tr", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(join(projectPath, ".tr", "plans"), { recursive: true });
  writeFileSync(join(projectPath, ".tr", "plans", ".gitkeep"), "", "utf8");

  const meta = {
    thinkrailSid,
    name: opts.name,
    skillId: opts.skillId ?? null,
    specIds: [],
    filePaths: [],
    status: opts.status ?? "done",
    sessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    config: {
      runtime: "claude",
      model: "claude-opus-4-8",
      permissionMode: "default",
      streamText: true,
      effort: "auto",
      flags: {},
    },
    metrics: {
      costUsd: 0,
      turns: 1,
      toolCalls: opts.events.filter((event) => event.eventType === "toolCallStart").length,
      durationMs: 1,
      contextMax: 0,
    },
  };

  writeFileSync(
    join(sessionsDir, `${thinkrailSid}.json`),
    JSON.stringify(meta, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(
    join(sessionsDir, `${thinkrailSid}.events.jsonl`),
    opts.events
      .map((event) => JSON.stringify({
        ...event,
        thinkrailSid,
        sessionId: event.sessionId ?? sessionId,
      }))
      .join("\n") + "\n",
    "utf8",
  );

  return thinkrailSid;
}
