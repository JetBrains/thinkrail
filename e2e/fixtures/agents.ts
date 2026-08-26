// Seeds a personal subagent definition into the e2e host's isolated pi agent dir, so the `@agent`
// subagent specs can delegate to a deterministic, near-free child instead of a real builtin (scout &
// co. carry tool allowlists and richer prompts — a research child could burn minutes and real tokens).
// Mirrors `templates.ts`'s fixture pattern: pure, re-callable, called once from `globalSetup`. Safe
// there: per-test `resetState` wipes `pi-agent/sessions/`, never `pi-agent/agents/`, so one seed covers
// the whole suite. The definition uses the community `.md` convention (`pi-subagents`
// `discoverAgentDefinitions` reads `<agentDir>/agents/*.md` as the "personal" tier).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_PI_AGENT_DIR } from "./paths";

/**
 * `echo` — a test subagent that parrots its task. `tools: read` keeps it away from bash/edit/write (a
 * stray tool call in a throwaway worktree would only add latency, but a *no*-tools child is the cheap,
 * deterministic shape these specs want); `max_turns: 3` bounds a confused model. No `model:` pin — a
 * definition without one inherits the parent's current model, which the e2e host pins deterministically
 * (`settings.json`, THINKRAIL_E2E_MODEL) — pinning here would fight that seam.
 */
export function seedAgentDefinitionFixtures(agentDir: string = E2E_PI_AGENT_DIR): void {
	const dir = join(agentDir, "agents");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "echo.md"),
		`---
name: echo
description: Test subagent that follows the task instruction exactly and replies tersely.
tools: read
max_turns: 3
---
You are EchoAgent, a test subagent. Follow the task instruction exactly and reply with exactly the
text it asks for — nothing else. Do not use tools unless the task explicitly requires reading a file.
`,
	);
}
