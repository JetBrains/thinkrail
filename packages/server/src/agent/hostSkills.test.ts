import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import en from "@thinkrail/locales/en.json";
import { resolveBuildRuntimeSources } from "../buildSupport";
import { listSkillCommands } from "./extensions";
import type { SkillAdmissionContext } from "./skillAdmission";

const HOST_SKILLS_DIR = join(import.meta.dir, "..", "..", "skills");
const GUIDE_SKILLS = ["about-thinkrail", "configuring-thinkrail"] as const;

function walkFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) files.push(...walkFiles(full));
		else files.push(full);
	}
	return files;
}

function parseFrontmatter(markdown: string): Record<string, string> {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	const fields: Record<string, string> = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!pair) continue;
		const key = pair[1];
		const raw = (pair[2] ?? "").trim();
		if (!key) continue;
		fields[key] = raw.replace(/^["']|["']$/g, "");
	}
	return fields;
}

function listBundledSkillNames(): Set<string> {
	const names = new Set<string>();
	for (const { source } of resolveBuildRuntimeSources().skillRoots) {
		for (const entry of readdirSync(source)) {
			const skillDir = join(source, entry);
			if (statSync(skillDir).isDirectory() && existsSync(join(skillDir, "SKILL.md"))) {
				names.add(entry);
			}
		}
	}
	return names;
}

function validSettingsSections(): Set<string> {
	const sections = new Set<string>();
	for (const [key, value] of Object.entries(en)) {
		if (key.startsWith("settings.nav.") && !key.startsWith("settings.nav.group.")) {
			sections.add(value);
		}
	}
	sections.add(en["settings.dialog.feedbackCta"]);
	return sections;
}

describe("bundled host skills", () => {
	it("every host skill has valid frontmatter and contains no test files", () => {
		const skillDirs = readdirSync(HOST_SKILLS_DIR).filter((entry) =>
			statSync(join(HOST_SKILLS_DIR, entry)).isDirectory(),
		);
		expect(skillDirs).toEqual(expect.arrayContaining([...GUIDE_SKILLS]));

		for (const dirName of skillDirs) {
			const skillDir = join(HOST_SKILLS_DIR, dirName);
			const files = walkFiles(skillDir);
			expect(files.filter((file) => /\.test\.[cm]?[jt]sx?$/.test(file))).toEqual([]);

			const skillMdPath = join(skillDir, "SKILL.md");
			expect(existsSync(skillMdPath)).toBe(true);
			const frontmatter = parseFrontmatter(readFileSync(skillMdPath, "utf8"));
			expect(frontmatter.name).toBe(dirName);
			expect((frontmatter.description ?? "").length).toBeGreaterThan(20);
		}
	});

	it("discovers about-thinkrail and configuring-thinkrail through the host skill loader", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "thinkrail-host-skills-"));
		const admission: SkillAdmissionContext = {
			trusted: false,
			piResourceTrusted: false,
			acknowledged: [],
			disabled: [],
			disabledGroups: [],
			enabledGroups: [],
			otherAgentSkills: false,
			overrides: {},
		};
		try {
			const commands = await listSkillCommands(cwd, admission);
			const names = commands.map((cmd) => cmd.name);
			expect(names).toEqual(expect.arrayContaining(GUIDE_SKILLS.map((name) => `skill:${name}`)));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("every reference/*.md path cited in a host skill exists on disk", () => {
		const skillDirs = readdirSync(HOST_SKILLS_DIR).filter((entry) =>
			statSync(join(HOST_SKILLS_DIR, entry)).isDirectory(),
		);
		for (const dirName of skillDirs) {
			const skillDir = join(HOST_SKILLS_DIR, dirName);
			const content = readFileSync(join(skillDir, "SKILL.md"), "utf8");
			for (const match of content.matchAll(/`?(reference\/[A-Za-z0-9._/-]+\.md)`?/g)) {
				const rel = match[1];
				if (!rel) continue;
				expect(existsSync(join(skillDir, rel))).toBe(true);
			}
		}
	});

	it("guide skills only cite real Settings sections and cover every Settings nav section", () => {
		const validSections = validSettingsSections();
		const citedSections = new Set<string>();

		for (const skill of GUIDE_SKILLS) {
			const files = walkFiles(join(HOST_SKILLS_DIR, skill)).filter((file) => file.endsWith(".md"));
			for (const file of files) {
				const text = readFileSync(file, "utf8");
				for (const match of text.matchAll(/\*\*Settings › ([^*]+?)\*\*/g)) {
					const section = match[1]?.replace(/\s+/g, " ").trim();
					if (!section || section === "…") continue;
					expect(validSections.has(section)).toBe(true);
					citedSections.add(section);
				}
			}
		}

		const settingsMap = readFileSync(
			join(HOST_SKILLS_DIR, "about-thinkrail", "reference", "settings-and-data.md"),
			"utf8",
		);
		const normalizedMap = settingsMap.replace(/\s+/g, " ");
		for (const section of validSections) {
			expect(normalizedMap).toContain(`**Settings › ${section}**`);
		}
		expect(citedSections.size).toBe(validSections.size);
	});

	it("every /skill:<name> command and sibling skill reference in guide skills matches a bundled skill", () => {
		const bundled = listBundledSkillNames();
		let checked = 0;

		for (const skill of GUIDE_SKILLS) {
			const files = walkFiles(join(HOST_SKILLS_DIR, skill)).filter((file) => file.endsWith(".md"));
			for (const file of files) {
				const text = readFileSync(file, "utf8");
				for (const match of text.matchAll(/\/skill:([a-z0-9-]+)/g)) {
					const name = match[1];
					if (!name) continue;
					expect(bundled.has(name)).toBe(true);
					checked += 1;
				}
			}
		}

		const aboutSkillMd = readFileSync(join(HOST_SKILLS_DIR, "about-thinkrail", "SKILL.md"), "utf8");
		const handoffSection = aboutSkillMd.match(/## Hand off to action skills[\s\S]*?(?=\n## |$)/);
		expect(handoffSection).not.toBeNull();
		for (const match of (handoffSection?.[0] ?? "").matchAll(/→ `([a-z0-9-]+)`/g)) {
			const name = match[1];
			if (!name) continue;
			expect(bundled.has(name)).toBe(true);
			checked += 1;
		}

		const conceptsMd = readFileSync(
			join(HOST_SKILLS_DIR, "about-thinkrail", "reference", "concepts.md"),
			"utf8",
		);
		const workflowsSection = conceptsMd.match(/## Bundled workflows[\s\S]*?(?=\n## |$)/);
		expect(workflowsSection).not.toBeNull();
		for (const line of (workflowsSection?.[0] ?? "").split(/\r?\n/)) {
			if (!line.trimStart().startsWith("- ")) continue;
			for (const match of line.matchAll(/`([a-z0-9-]+)`/g)) {
				const name = match[1];
				if (!name) continue;
				expect(bundled.has(name)).toBe(true);
				checked += 1;
			}
		}

		expect(checked).toBeGreaterThanOrEqual(15);
	});

	it("configuring-thinkrail encodes host safety invariants", () => {
		const content = readFileSync(
			join(HOST_SKILLS_DIR, "configuring-thinkrail", "SKILL.md"),
			"utf8",
		);
		expect(content).toContain("Never edit `~/.thinkrail/config.json`");
		expect(content).toContain("Never run `pi` CLI commands");
		expect(content).toContain("Never read or print secrets");
		expect(content).toContain("cannot be added in **Settings ›");
	});
});
