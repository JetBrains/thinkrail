import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_PI_AGENT_DIR } from "./paths";

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
	writeFileSync(
		join(dir, "defaults.md"),
		`---
description: One argument, two different per-occurrence defaults (regression fixture)
---
\${1:-foo} versus \${1:-bar}
`,
	);
}

export function removeGlobalTemplates(names: string[], agentDir: string = E2E_PI_AGENT_DIR): void {
	const dir = join(agentDir, "prompts");
	for (const name of names) {
		rmSync(join(dir, `${name}.md`), { force: true });
	}
}

export function clearTemplateFixtures(agentDir: string = E2E_PI_AGENT_DIR): void {
	removeGlobalTemplates(["review", "rename", "adjacent", "defaults"], agentDir);
}
