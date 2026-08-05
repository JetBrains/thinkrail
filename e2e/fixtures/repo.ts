import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./paths";

/**
 * Whether the shared fixture repo is a live git repo the suite can open + `resetState` can prune. Returns
 * `false` if the directory is gone or isn't a repo — the case an `@agent` spec can create: it drives a real
 * agent with `bash` in a *worktree of this repo*, so a stray destructive command can remove it out from
 * under every later test (see `seedFixtureRepo`).
 */
export function fixtureRepoHealthy(): boolean {
	try {
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "rev-parse", "--git-dir"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * (Re)create the shared fixture repo: a throwaway git repo carrying the seed files every suite opens as a
 * "project" — README + a non-markdown file, the markdown-preview demos (alerts/links + a real PNG), and a
 * small seed spec graph (root + one child), and a portable Claude-compatible skill. Extracted so global
 * setup seeds it once and per-test
 * `resetState` can re-seed it if a flaky `@agent` run damaged the shared repo — bounding the blast radius to
 * that one spec instead of cascading into every later test's reset.
 */
export function seedFixtureRepo(): void {
	mkdirSync(E2E_FIXTURE_REPO, { recursive: true });
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, ...args], { stdio: "ignore" });
	git("init", "-b", "main");
	git("config", "user.email", "e2e@thinkrail.test");
	git("config", "user.name", "ThinkRail E2E");
	writeFileSync(join(E2E_FIXTURE_REPO, "README.md"), "# sample-project\n");
	// A non-markdown file so the editor suite can assert the source-only path (no rendered-view toggle).
	writeFileSync(join(E2E_FIXTURE_REPO, "notes.txt"), "plain-text-fixture\n");
	// A markdown file exercising GitHub-style alert callouts (+ a plain blockquote for contrast), for the
	// rendered-preview suite (see e2e/markdown-alerts.spec.ts).
	writeFileSync(
		join(E2E_FIXTURE_REPO, "ALERTS.md"),
		[
			"# Alert callouts",
			"",
			"> [!NOTE]",
			"> Useful information users should know.",
			"",
			"> [!TIP]",
			"> Helpful advice for doing things better.",
			"",
			"> [!IMPORTANT]",
			"> Key information to achieve a goal.",
			"",
			"> [!WARNING]",
			"> Urgent info needing immediate attention.",
			"",
			"> [!CAUTION]",
			"> Advises about risky outcomes.",
			"",
			"> A plain blockquote, no marker, so it stays a quote.",
			"",
		].join("\n"),
	);
	// A large, highly repetitive markdown doc (hundreds of identical list rows) — the worst case
	// for node-htmldiff's matcher — for the rendered-diff main-thread test (see e2e/changes.spec.ts):
	// diffing this inline used to block the UI for seconds, so the suite pins that the merge stays off
	// the main thread.
	writeFileSync(join(E2E_FIXTURE_REPO, "LARGE.md"), largeRepetitiveMarkdown());
	// A doc + image for the rendered-preview link/anchor/image suite (see e2e/markdown-links.spec.ts):
	// a relative file link (opens the target tab), an in-doc anchor, and a relative image (host /files route).
	writeFileSync(
		join(E2E_FIXTURE_REPO, "LINKS.md"),
		[
			"# Link demo",
			"",
			"Jump to [Section two](#section-two), open [the spec](SPEC.md), and see the logo:",
			"",
			"![logo](logo.png)",
			"",
			"## Section two",
			"",
			"Target of the in-document anchor.",
			"",
		].join("\n"),
	);
	// A real 1x1 PNG so the relative-image path serves actual image bytes over the host /files route.
	writeFileSync(
		join(E2E_FIXTURE_REPO, "logo.png"),
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGB9x0AAAAASUVORK5CYII=",
			"base64",
		),
	);
	// A seed spec so the @agent `spec-tools` suite has a deterministic `spec_grep` match, proving the
	// bundled `pi-spec-graph` extension is wired into a live session (see e2e/spec-tools.live.spec.ts). The
	// token SPECGRAPHPROBE is distinctive so a match can't be an echo of the query; the file path it lives
	// in is the proof of a real hit.
	writeFileSync(
		join(E2E_FIXTURE_REPO, "SPEC.md"),
		"---\nid: sample-root\ntype: goal-and-requirements\ntitle: Sample Project\n---\n\n## Goal\n\nA throwaway fixture project for the thinkrail e2e suite. It carries the token SPECGRAPHPROBE so spec_grep has a deterministic match to find.\n",
	);
	// A child spec under the root, so the Specs viewer has a deterministic parent-tree to render
	// (see e2e/specs-panel.spec.ts).
	mkdirSync(join(E2E_FIXTURE_REPO, "module-a"), { recursive: true });
	writeFileSync(
		join(E2E_FIXTURE_REPO, "module-a", "SPEC.md"),
		"---\nid: sample-module\ntype: module-design\nstatus: active\ntitle: Sample Module\nparent: sample-root\n---\n\n## Responsibility\n\nA fixture module spec, child of sample-root.\n",
	);
	// A portable project alias used by the no-agent New Workspace autocomplete test.
	const skillDir = join(E2E_FIXTURE_REPO, ".claude", "skills", "e2e-portable");
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, "SKILL.md"),
		"---\nname: e2e-portable\ndescription: Portable e2e fixture skill\n---\n\n# Portable skill\n",
	);
	git("add", "-A");
	git("commit", "-m", "init");
}

// ─── The opt-in bare remote (remote-awareness specs only) ─────────────────────────────────────────
// The shared fixture repo has NO remote by default — `new-workspace.spec.ts` pins that as a property
// (`origin` must never appear as a branch option). So this is a per-spec opt-in, never folded into
// `seedFixtureRepo`: a spec calls `addBareRemote`, does its work, then `removeBareRemote` in its own
// teardown, leaving every other spec's "no remote" world untouched.

/**
 * Add a local **bare** repo as the fixture's `origin` and seed `main` onto it — a write-nothing,
 * credential-free stand-in for a real hosted remote, so the remote-awareness specs need no network and no
 * auth. Critically, this also runs an explicit `git fetch origin` after the push: `remote add` + `push`
 * alone does NOT create the local `refs/remotes/origin/main` tracking ref (only a real fetch does), and
 * without it `resolveDefaultBranch` falls back to the local `main` branch instead of `origin/main` — which
 * would silently defeat every one of these specs (only remote-tracking refs are ever scheduler-checked).
 * Returns the bare repo's path, threaded through to `pushUpstreamCommit`/`deleteUpstreamBranch`.
 */
export function addBareRemote(): string {
	const barePath = join(E2E_DATA_DIR, "sample-project-origin.git");
	rmSync(barePath, { recursive: true, force: true });
	execFileSync("git", ["init", "--bare", "-b", "main", barePath], { stdio: "ignore" });
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, ...args], { stdio: "ignore" });
	git("remote", "add", "origin", barePath);
	git("push", "origin", "main");
	git("fetch", "origin");
	return barePath;
}

/** Undo `addBareRemote`: drop the fixture's `origin` remote and delete the bare repo. Idempotent — safe to
 * call even if a spec already removed the remote itself (e.g. mid-test cleanup). */
export function removeBareRemote(barePath: string): void {
	try {
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "remote", "remove", "origin"], {
			stdio: "ignore",
		});
	} catch {
		// Already gone — nothing to undo.
	}
	rmSync(barePath, { recursive: true, force: true });
}

/**
 * Push one new commit onto the bare remote's `main`, simulating "someone else pushed upstream" — via a
 * throwaway clone, deliberately NOT the fixture repo's own checkout: committing there and pushing would
 * advance the fixture's local `main` right along with `origin/main`, leaving nothing behind to detect. The
 * clone is the only writer that moves the remote without also moving the local tracking ref.
 */
export function pushUpstreamCommit(barePath: string): void {
	const scratch = mkdtempSync(join(tmpdir(), "thinkrail-e2e-upstream-"));
	try {
		execFileSync("git", ["clone", barePath, scratch], { stdio: "ignore" });
		const git = (...args: string[]) =>
			execFileSync("git", ["-C", scratch, ...args], { stdio: "ignore" });
		git("config", "user.email", "e2e@thinkrail.test");
		git("config", "user.name", "ThinkRail E2E");
		writeFileSync(join(scratch, `upstream-${Date.now()}.txt`), "moved\n");
		git("add", "-A");
		git("commit", "-m", "upstream moves on");
		git("push", "origin", "main");
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

/**
 * Delete `main` on the bare remote directly — `update-ref -d`, never `branch -D`: a bare repo's `HEAD`
 * symref still points at `refs/heads/main`, and the porcelain delete refuses to remove a branch HEAD
 * names, which is exactly the safety check this plumbing command bypasses (there's no working tree to
 * switch off of first, since the repo is bare). Simulates a merged-and-deleted PR branch upstream.
 */
export function deleteUpstreamBranch(barePath: string): void {
	execFileSync("git", ["-C", barePath, "update-ref", "-d", "refs/heads/main"], { stdio: "ignore" });
}

/**
 * The seeded contents of `LARGE.md`: 800 **identical** list rows — identical (not merely similar)
 * rows are what degrades node-htmldiff's matching to multi-second runtimes (unique rows match in
 * linear time). `largeRepetitiveMarkdownEdited` derives the worktree-side edit here too, so the
 * doc's shape (header offset, row text) lives in exactly one place.
 */
export function largeRepetitiveMarkdown(): string {
	const rows = Array.from({ length: 800 }, () => "- alpha beta gamma delta epsilon");
	return `# Large repetitive doc\n\n${rows.join("\n")}\n`;
}

/** The edited worktree version: one mid-document row replaced + one row appended. */
export function largeRepetitiveMarkdownEdited(): string {
	const lines = largeRepetitiveMarkdown().split("\n");
	lines[400] = "- EDITED replacement row";
	return `${lines.join("\n")}- appended row by e2e\n`;
}
