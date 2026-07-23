// Seeds a real prompt-template file directly into the e2e host's isolated agent dir (bypassing the wire),
// so `template.list`/`template.get` — and the composer's `/` menu (Task B5) — have something real to
// discover. Mirrors `sessions.ts`'s fixture pattern: a pure, re-callable seeding function, called once
// from `globalSetup`. Safe there: per-test `resetState` (`fixtures/app.ts`) wipes `pi-agent/sessions/`, not
// `pi-agent/prompts/`, so this never needs re-seeding mid-suite the way session fixtures sometimes do.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
 *
 * A third template (`adjacent.md`) is `$1$2` with no literal text between them and deliberately **no**
 * `argument-hint` at all, so both markers fall back to pi's `arg${n}` naming — `⟨arg1⟩`/`⟨arg2⟩`, 6 chars
 * each — producing two slots with **zero gap**: `slots[0]` is exactly `[0, 6)`, `slots[1]` exactly
 * `[6, 12)`. This is the shape the B5 review's zero-gap boundary bug needed (`slotSession.ts`'s
 * `mapOffset` doc): filling slot 1 with more than one keystroke used to corrupt slot 2's `start`, one
 * character at a time, because a zero-width insert landing exactly on `slots[0].end === slots[1].start`
 * was silently absorbed into the following slot instead of pushing it along.
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
	writeFileSync(
		join(dir, "adjacent.md"),
		`---
description: Two zero-gap adjacent slots (regression fixture)
---
$1$2
`,
	);
}

/**
 * Removes named global template files, by template name (not filename) — a targeted delete, never a
 * blanket directory wipe, so this can't clobber something an unrelated test/file has independently
 * written into the same shared prompts dir. The primitive both helpers below are built from.
 */
export function removeGlobalTemplates(names: string[], agentDir: string = E2E_PI_AGENT_DIR): void {
	const dir = join(agentDir, "prompts");
	for (const name of names) {
		rmSync(join(dir, `${name}.md`), { force: true });
	}
}

/**
 * Removes just the three `seedTemplateFixtures` files. `globalSetup` seeds them once for the whole run
 * and `resetState` never wipes `prompts/` (see this file's header), so the Global templates group is
 * otherwise never empty during the suite — a test of the empty-state starter-templates offer (R3+R4
 * brief, `templates-manage.spec.ts`) has to manufacture that condition itself. Paired with a re-call of
 * `seedTemplateFixtures()` to restore them once that test is done, so every other test/file keeps seeing
 * the same three fixtures regardless of run order.
 */
export function clearTemplateFixtures(agentDir: string = E2E_PI_AGENT_DIR): void {
	removeGlobalTemplates(["review", "rename", "adjacent"], agentDir);
}
