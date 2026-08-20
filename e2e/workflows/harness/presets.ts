import "./env";
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { setSessionManagerFactory } from "@thinkrail/server/agent";
import { E2E_DATA_DIR } from "../../fixtures/paths";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

export function applyArtifactPreset(cwd: string, files: Record<string, string>): void {
	for (const [relative, content] of Object.entries(files)) {
		const path = join(cwd, relative);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
}

export const FIXTURE_MD_SUFFIX = ".test";

const MASKED_RE = /\.md\.test$/;

export function maskFixtureMarkdown(dir: string): void {
	for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const path = join(entry.parentPath, entry.name);
		renameSync(path, `${path}${FIXTURE_MD_SUFFIX}`);
	}
}

export function unmaskFixtureMarkdown(dir: string): void {
	for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile() || !MASKED_RE.test(entry.name)) continue;
		const path = join(entry.parentPath, entry.name);
		renameSync(path, path.slice(0, -FIXTURE_MD_SUFFIX.length));
	}
}

let fixtureCounter = 0;

export function useTranscriptFixture(name: string, cwd: string): () => void {
	const fixtureDir = join(FIXTURES_DIR, name);
	const sessionFile = join(fixtureDir, "session.jsonl");
	let raw: string;
	try {
		raw = readFileSync(sessionFile, "utf8");
	} catch (error) {
		throw new Error(
			`Transcript fixture "${name}" is missing (${sessionFile}). Regenerate it with ` +
				`THINKRAIL_WORKFLOW_RECORD=1 bun run test:workflows (see recordFixture). ${error}`,
		);
	}
	cpSync(join(fixtureDir, "workspace"), cwd, { recursive: true, force: true });
	unmaskFixtureMarkdown(cwd);
	const header = JSON.parse(raw.slice(0, raw.indexOf("\n"))) as { cwd?: string };
	const recordedCwd = header.cwd;
	const rewritten = recordedCwd ? raw.split(recordedCwd).join(cwd) : raw;
	const tmp = join(E2E_DATA_DIR, `workflow-fixture-${++fixtureCounter}.jsonl`);
	writeFileSync(tmp, rewritten);
	setSessionManagerFactory(() => SessionManager.open(tmp));
	return () => setSessionManagerFactory((factoryCwd) => SessionManager.create(factoryCwd));
}

export function includeInFixtureSnapshot(source: string): boolean {
	return !/\/\.git(\/|$)/.test(source);
}

export function isRecordMode(): boolean {
	return process.env.THINKRAIL_WORKFLOW_RECORD === "1";
}

export async function recordFixture(name: string, cwd: string): Promise<void> {
	const infos = (await SessionManager.list(cwd)).filter((info) => info.cwd === cwd);
	const newest = infos.sort((a, b) => b.modified.getTime() - a.modified.getTime())[0];
	if (!newest) throw new Error(`recordFixture("${name}"): no session recorded under ${cwd}`);
	const fixtureDir = join(FIXTURES_DIR, name);
	mkdirSync(fixtureDir, { recursive: true });
	cpSync(newest.path, join(fixtureDir, "session.jsonl"));
	const workspaceDir = join(fixtureDir, "workspace");
	cpSync(cwd, workspaceDir, {
		recursive: true,
		force: true,
		filter: includeInFixtureSnapshot,
	});
	maskFixtureMarkdown(workspaceDir);
}
