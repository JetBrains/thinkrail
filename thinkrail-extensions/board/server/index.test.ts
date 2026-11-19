import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import extension from "./index";
import { ROADMAP_CHATS, ROADMAP_SKILLS } from "./kickoff";

const SKILLS = [
	"initiative-close",
	"roadmap-plan",
	"roadmap-report",
	"roadmap-review",
	"roadmap-shape",
] as const;

function skillRoots(): string[] {
	const require = createRequire(import.meta.url);
	return (extension.skillPackages ?? []).flatMap((specifier) => {
		const manifestPath = require.resolve(`${specifier}/package.json`);
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			pi?: { skills?: string[] };
		};
		return (manifest.pi?.skills ?? []).map((dir) => resolve(dirname(manifestPath), dir));
	});
}

function frontmatter(path: string): Record<string, string> {
	const text = readFileSync(path, "utf8");
	const head = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
	return Object.fromEntries(
		head.split("\n").flatMap((line) => {
			const match = /^(\w+):\s*(.*)$/.exec(line);
			return match?.[1] ? [[match[1], (match[2] ?? "").replace(/^"|"$/g, "")]] : [];
		}),
	);
}

describe("board server half", () => {
	test("ships its roadmap skills as its own skill package, resolved like the host does", () => {
		expect(extension.skillPackages).toEqual(["@thinkrail/ext-board"]);
		const roots = skillRoots();
		expect(roots).toHaveLength(1);
		const [root] = roots;
		if (!root) throw new Error("no skill root");
		expect(readdirSync(root).sort()).toEqual([...SKILLS]);
		for (const name of SKILLS) {
			const path = join(root, name, "SKILL.md");
			const meta = frontmatter(path);
			expect(meta.name).toBe(name);
			expect(meta.description?.startsWith("Use when")).toBe(true);
			expect(readFileSync(path, "utf8").split("\n").length).toBeLessThan(60);
		}
	});

	test("every roadmap chat's kickoff names a shipped skill", () => {
		expect(ROADMAP_CHATS.map((kind) => ROADMAP_SKILLS[kind]).sort()).toEqual([...SKILLS]);
	});

	test("each skill names only board tools the board registers", () => {
		const root = skillRoots()[0] ?? "";
		const registered = readFileSync(join(import.meta.dir, "tools.ts"), "utf8");
		for (const name of SKILLS) {
			const body = readFileSync(join(root, name, "SKILL.md"), "utf8");
			for (const [tool] of body.matchAll(/board_[a-z_]+/g))
				expect(registered).toContain(`name: "${tool}"`);
		}
	});
});
