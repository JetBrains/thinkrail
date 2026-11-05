import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import {
	ask,
	assistantText,
	isSkillLoad,
	readSession,
	toolCalls,
} from "./fixtures/skillCompaction";

const SKILL = "zz-quokka-invoices";
const FILLERS = 250;
const MARKER = "quokka-reconciled";
const skillsRoot = join(E2E_PI_AGENT_DIR, "skills");

const filler = (i: number) => `---
name: chore-${i}
description: "Use when tidying routine chore ${i} in a sandbox repository: renaming scratch files, sorting import blocks, refreshing fixtures and similar maintenance that never touches billing."
---

Do chore ${i} carefully.
`;

const SKILL_BODY = `---
name: ${SKILL}
description: "Use when reconciling quokka invoices against the payment log."
---

# Quokka invoices

A reconciliation reply ends with a final line that is exactly \`${MARKER}: <N>\`, where N is the
number of invoices you compared.
`;

test("the agent finds and follows a skill the budgeted catalog left unlisted", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(400_000);
	const dirs = [
		...Array.from({ length: FILLERS }, (_, i) => [`chore-${i}`, filler(i)] as const),
		[SKILL, SKILL_BODY] as const,
	];
	for (const [name, body] of dirs) {
		mkdirSync(join(skillsRoot, name), { recursive: true });
		writeFileSync(join(skillsRoot, name, "SKILL.md"), body);
	}
	try {
		const workspace = await openWorkspaceChat(page);
		writeFileSync(
			join(workspace.worktreePath, "invoices.txt"),
			"INV-1 40.00\nINV-2 12.50\nINV-3 7.25\n",
		);
		writeFileSync(join(workspace.worktreePath, "payments.txt"), "INV-1 40.00\nINV-3 7.25\n");
		await ask(
			page,
			"Reconcile the quokka invoices in invoices.txt against the payment log in payments.txt and tell me which are unpaid.",
		);

		const entries = readSession(workspace.worktreePath);
		const searches = entries.flatMap((entry) =>
			toolCalls(entry).filter((call) => call.name === "skill_search"),
		);
		const reply = entries.map(assistantText).filter(Boolean).at(-1) ?? "";
		await test.info().attach("skill-search.json", {
			body: JSON.stringify({ searches, reply }, null, 2),
			contentType: "application/json",
		});

		const transcript = JSON.stringify(entries);
		expect(transcript, "the catalog was budgeted").toMatch(
			/Only \d+ of \d+ skills are listed here/,
		);
		expect(transcript, "the skill was left out of the listing").not.toContain(
			`<name>${SKILL}</name>`,
		);
		expect(
			searches.length > 0 || transcript.includes("Skills not listed in the system prompt"),
			"the agent was pointed at the catalog by a hint or its own search",
		).toBe(true);
		expect(
			entries.some((entry) => isSkillLoad(entry, SKILL)),
			"the agent read the found skill",
		).toBe(true);
		expect(reply.trim()).toMatch(new RegExp(`${MARKER}: 3$`));
	} finally {
		for (const [name] of dirs) rmSync(join(skillsRoot, name), { recursive: true, force: true });
	}
});
