import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { openWorkspaceChat } from "./fixtures/app";
import { E2E_PI_AGENT_DIR } from "./fixtures/paths";
import {
	ask,
	assistantText,
	compact,
	isSkillLoad,
	pushPastCompactionTail,
	readSession,
	type SessionEntry,
} from "./fixtures/skillCompaction";

const SKILL = "release-ledger";
const SKILL_DIR = join(E2E_PI_AGENT_DIR, "skills", SKILL);

// Six checkable rules that exist only in this skill body. They sit past the first 2000 characters, as
// a real skill's later steps do: pi's summarizer truncates each tool result (a `read` of SKILL.md) there.
const SKILL_BODY = `---
name: ${SKILL}
description: "Use when creating or editing source files in this repository."
---

# Release ledger

The release ledger is how this repository's release tooling learns which files changed and why. The
tooling is strict: a file that breaks any rule below is rejected from the next release, and the
rejection is silent, so the only protection is following every rule every time.

## Background

The ledger replaced a hand-maintained changelog that drifted from the tree within weeks. Reviewers
could not tell which files a release touched, so regressions shipped in files nobody remembered
changing. The ledger makes every change explicit at the moment it happens, by whoever made it, in a
shape a script can read without guessing.

Three consumers read it. The release scanner walks the tree and trusts only tracked files. The
manifest differ compares the manifest with the files on disk and blocks a release on any mismatch.
The release-notes generator turns ledger lines into the human changelog, so a vague reason becomes a
vague release note that a customer reads.

None of the consumers report errors back to the author. They were built for a batch pipeline that
runs after the change is merged, long after anyone would look at the output. That is why the rules
below are phrased as exact shapes: there is no tolerance, no fuzzy matching, and no second chance.

Treat the rules as part of the definition of done for any file change. A change that works but breaks
a rule is not finished; it will quietly fall out of the next release and someone will spend a day
finding out why.

The rules are grouped by where they apply: the files you write, the ledger itself, and the reply you
send. Each group is short on purpose, and each rule names the exact text the tooling expects, so you
never have to infer a format from an example. When a rule and an example disagree, the rule wins; the
example at the end only shows the rules applied together to one small file.

## Rules for every TypeScript file you create

1. **Tracking header.** The very first line of the file is exactly \`// @ledger-tracked\`. The release
   scanner reads only the first line; a header on line two is invisible to it.
2. **Owner tag.** The line directly above each \`export\` is exactly \`/** ledger-owner: release */\`.
   Blank lines between the tag and the export break the association.

## Rules for the ledger itself

3. **Ledger line.** After you create or edit a file, append one line to \`LEDGER.md\` at the repository
   root in the exact shape \`- <path> :: <reason>\`, where the reason is three to six lowercase words.
   Create \`LEDGER.md\` if it is missing and never list \`LEDGER.md\` or the manifest itself.
4. **Manifest.** Keep \`lib/MANIFEST.json\` as a JSON array of every \`lib/*.ts\` path, sorted
   alphabetically, rewritten whenever a file is added. The release tooling diffs it against the tree.

## Rules for your reply

5. **Opening line.** A reply that changed files starts with a line beginning \`Ledger run:\` followed by
   the number of files you touched.
6. **Closing line.** The same reply ends with a final line that is exactly \`ledger-ok: <N>\`, where N is
   the number of lines in \`LEDGER.md\`.

## Example

Creating \`lib/alpha.ts\` produces:

\`\`\`ts
// @ledger-tracked
/** ledger-owner: release */
export const alpha = "a";
\`\`\`

the ledger line \`- lib/alpha.ts :: add alpha constant export\`, the manifest \`["lib/alpha.ts"]\`, and a
reply that opens \`Ledger run: 1 file\` and closes \`ledger-ok: 1\`.
`;

const PHASES = [
	{ key: "A", words: ["one", "two", "three"] },
	{ key: "B", words: ["four", "five", "six"] },
	{ key: "C", words: ["seven", "eight", "nine"] },
] as const;

const prompt = (words: readonly string[]) =>
	`Create three tiny TypeScript files: ${words.map((w) => `lib/${w}.ts exporting const ${w} = "${w}"`).join(", ")}.`;

function userText(entry: SessionEntry): string {
	if (entry.type !== "message" || entry.message?.role !== "user") return "";
	return JSON.stringify(entry.message.content ?? "");
}

function phaseReply(entries: SessionEntry[], words: readonly string[]): string {
	const start = entries.findIndex((e) => userText(e).includes(`lib/${words[0]}.ts`));
	const end = entries.findIndex((e, i) => i > start && userText(e) !== "");
	const slice = entries.slice(start, end < 0 ? undefined : end);
	return slice.map(assistantText).filter(Boolean).at(-1) ?? "";
}

function score(root: string, entries: SessionEntry[], words: readonly string[]) {
	const read = (path: string) =>
		existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "";
	const ledger = read("LEDGER.md");
	const manifest = read("lib/MANIFEST.json");
	const reply = phaseReply(entries, words).trim();
	const files = words.map((w) => read(`lib/${w}.ts`));
	const rules = {
		header: files.every((f) => f.split("\n")[0] === "// @ledger-tracked"),
		ownerTag: files.every((f) => /\/\*\* ledger-owner: release \*\/\nexport /.test(f)),
		ledgerLine: words.every((w) =>
			new RegExp(`^- lib/${w}\\.ts :: [a-z]+( [a-z]+){2,5}$`, "m").test(ledger),
		),
		manifest: words.every((w) => manifest.includes(`"lib/${w}.ts"`)),
		openingLine: reply.startsWith("Ledger run:"),
		closingLine: /ledger-ok: \d+$/.test(reply),
	};
	return { followed: Object.values(rules).filter(Boolean).length, rules };
}

test("the agent keeps following a long body-only skill across repeated compactions", {
	tag: "@agent",
}, async ({ page }) => {
	test.setTimeout(900_000);
	mkdirSync(SKILL_DIR, { recursive: true });
	writeFileSync(join(SKILL_DIR, "SKILL.md"), SKILL_BODY);
	try {
		const workspace = await openWorkspaceChat(page);
		await ask(page, `Read the ${SKILL} skill first and follow it. ${prompt(PHASES[0].words)}`);
		for (const phase of PHASES.slice(1)) {
			await pushPastCompactionTail(page);
			await compact(page, workspace.worktreePath);
			await ask(page, prompt(phase.words));
		}

		const entries = readSession(workspace.worktreePath);
		const compactions = entries.filter((e) => e.type === "compaction");
		const scores = Object.fromEntries(
			PHASES.map((phase) => [phase.key, score(workspace.worktreePath, entries, phase.words)]),
		);
		const skillLoads = entries.flatMap((e, i) => (isSkillLoad(e, SKILL) ? [i] : []));
		const firstCompaction = entries.findIndex((e) => e.type === "compaction");
		await test.info().attach("skill-compliance.json", {
			body: JSON.stringify(
				{
					scores,
					skillLoads,
					compactionIndexes: entries.flatMap((e, i) => (e.type === "compaction" ? [i] : [])),
					summaries: compactions.map((c) => c.summary),
				},
				null,
				2,
			),
			contentType: "application/json",
		});

		expect(compactions).toHaveLength(2);
		expect(scores.A?.followed, "phase A followed the loaded skill").toBe(6);
		expect(scores.B, "phase B, after one compaction").toEqual(scores.A);
		expect(scores.C, "phase C, after two compactions").toEqual(scores.A);
		expect(
			skillLoads.filter((i) => i > firstCompaction),
			"the restored skill needed no re-read",
		).toEqual([]);
	} finally {
		rmSync(SKILL_DIR, { recursive: true, force: true });
	}
});
