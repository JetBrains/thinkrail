// Seeds a real prompt-template file directly into the e2e host's isolated agent dir (bypassing the wire),
// so `template.list`/`template.get` — and the composer's `/` menu (Task B5) — have something real to
// discover. Mirrors `sessions.ts`'s fixture pattern: a pure, re-callable seeding function, called once
// from `globalSetup`. Safe there: per-test `resetState` (`fixtures/app.ts`) wipes `pi-agent/sessions/`, not
// `pi-agent/prompts/`, so this never needs re-seeding mid-suite the way session fixtures sometimes do.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_PI_AGENT_DIR } from "./paths";

/**
 * A global-scope template (`${agentDir}/prompts/review.md`) with one unfilled positional slot (`$1`, no
 * default — a marker the user must type over) and one prefilled-default slot (`${2:-src/}` — already
 * "src/", tab-through with no typing required), exercising both slot flavors `slotSession.ts` produces.
 * `argument-hint` is quoted: pi's frontmatter is real YAML (the `yaml` package), and an unquoted
 * `[file] [scope]` isn't valid flow-sequence syntax.
 *
 * A second template (`rename.md`) repeats `$1` twice — same positional slot, same `group` — so the
 * composer's Tab-out **group mirroring** (splice the just-filled slot's text into every sibling sharing
 * its group) has something real to exercise: filling the first `⟨name⟩` occurrence and tabbing out must
 * propagate the typed text into the second occurrence without the user typing it twice.
 */
export function seedTemplateFixtures(agentDir: string = E2E_PI_AGENT_DIR): void {
	const dir = join(agentDir, "prompts");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "review.md"),
		`---
description: Review a file for issues
argument-hint: "[file] [scope]"
---
Review $1 for issues, focusing on \${2:-src/}.
`,
	);
	writeFileSync(
		join(dir, "rename.md"),
		`---
description: Rename a symbol everywhere
argument-hint: "[name]"
---
Rename $1 and update every $1 reference.
`,
	);
}
