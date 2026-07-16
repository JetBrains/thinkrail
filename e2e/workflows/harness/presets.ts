// Mid-flow entry — start a scenario in the middle of a workflow.
// Two mechanisms (../SPEC.md § presets):
// - Artifact preset (workflow-native): seed the workflow's own state (the task-spec is the workflow's
//   spine), enter with a "continue" prompt. Mirrors real resumption.
// - Transcript preset (dialog-level): reopen a recorded session file via SessionManager.open, injected
//   through the server's setSessionManagerFactory seam. A fixture = session.jsonl + a workspace/
//   snapshot (session files embed their cwd and tool results reference old paths — replay re-seeds the
//   files and rewrites recorded-cwd → new-cwd in a temp copy; the committed fixture stays pristine).
// Fixtures are born via record mode: THINKRAIL_WORKFLOW_RECORD=1 snapshots a live scenario's transcript
// + workspace into e2e/workflows/fixtures/<name>/.
//
// Fixture markdown is MASKED at rest: every `*.md` in a snapshot is stored as `*.md.test` (and unmasked
// on replay), so fixture specs — real frontmatter like `id: acme-root` — never pollute the host repo's
// own spec graph (spec discovery globs `*.md`; the product's Specs rail and spec_grep would otherwise
// surface them as thinkrail nodes).
import "./env";
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { setSessionManagerFactory } from "@thinkrail/server/agent";
import { E2E_DATA_DIR } from "../../fixtures/paths";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures", import.meta.url));

/** Write workflow-owned state (task-spec, working files) into the workspace before the session starts. */
export function applyArtifactPreset(cwd: string, files: Record<string, string>): void {
	for (const [relative, content] of Object.entries(files)) {
		const path = join(cwd, relative);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, content);
	}
}

/** The at-rest suffix masking fixture markdown from spec discovery (`SPEC.md` → `SPEC.md.test`). */
export const FIXTURE_MD_SUFFIX = ".test";

const MASKED_RE = /\.md\.test$/;

/** Rename every `*.md` under `dir` to `*.md.test` (record side). */
export function maskFixtureMarkdown(dir: string): void {
	for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const path = join(entry.parentPath, entry.name);
		renameSync(path, `${path}${FIXTURE_MD_SUFFIX}`);
	}
}

/** Rename every `*.md.test` under `dir` back to `*.md` (replay side). */
export function unmaskFixtureMarkdown(dir: string): void {
	for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile() || !MASKED_RE.test(entry.name)) continue;
		const path = join(entry.parentPath, entry.name);
		renameSync(path, path.slice(0, -FIXTURE_MD_SUFFIX.length));
	}
}

let fixtureCounter = 0;

/**
 * Continue a recorded session: re-seed the fixture's workspace snapshot into `cwd`, rewrite the recorded
 * cwd to the new one in a temp copy of the transcript, and point the session-manager factory at it.
 * Returns a restore fn — ALWAYS call it in the scenario's `finally` (the factory is a process-wide seam).
 */
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
	unmaskFixtureMarkdown(cwd); // fixture markdown is stored masked (see module header)
	const header = JSON.parse(raw.slice(0, raw.indexOf("\n"))) as { cwd?: string };
	const recordedCwd = header.cwd;
	const rewritten = recordedCwd ? raw.split(recordedCwd).join(cwd) : raw;
	const tmp = join(E2E_DATA_DIR, `workflow-fixture-${++fixtureCounter}.jsonl`);
	writeFileSync(tmp, rewritten);
	setSessionManagerFactory(() => SessionManager.open(tmp));
	return () => setSessionManagerFactory((factoryCwd) => SessionManager.create(factoryCwd));
}

/**
 * Whether a path belongs in a fixture's workspace snapshot: everything except the `.git` DIRECTORY
 * itself — dotfiles like `.gitignore`/`.github` are real workspace content and must be captured.
 */
export function includeInFixtureSnapshot(source: string): boolean {
	return !/\/\.git(\/|$)/.test(source);
}

/** Whether this run is a fixture-recording run. */
export function isRecordMode(): boolean {
	return process.env.THINKRAIL_WORKFLOW_RECORD === "1";
}

/**
 * Snapshot a live scenario's transcript + workspace as a committed fixture (record mode only): the
 * newest session file recorded under `cwd` + the workspace files (git internals excluded).
 */
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
	maskFixtureMarkdown(workspaceDir); // keep fixture specs out of the host repo's spec graph
}
