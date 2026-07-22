// Context preset — the throwaway cwd a scenario's workflow runs in (what routers classify against).
// Every workspace is a fresh, committed git repo under E2E_DATA_DIR (wiped by global teardown).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_DATA_DIR } from "../../fixtures/paths";

export type WorkspaceKind = "empty" | "code-only" | "specced";
export type WorkspaceSeed = WorkspaceKind | ((cwd: string) => void);

let counter = 0;

/** Fabricate a workspace: fresh dir, git init + commit; custom seeds run after the base init. */
export function seedWorkspace(seed: WorkspaceSeed): string {
	// The pid keeps names unique across Playwright WORKER RESTARTS too: after a test failure the next
	// test runs in a fresh worker whose module state (this counter) resets — a bare counter would then
	// reuse workflow-ws-1 with the failed test's leftovers inside (a poisoned fixture) and collide on
	// pi's per-cwd session dir (observed as mid-run ENOENT on the session jsonl).
	const cwd = join(E2E_DATA_DIR, `workflow-ws-${process.pid}-${++counter}`);
	mkdirSync(cwd, { recursive: true });
	const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
	git("init", "-b", "main");
	git("config", "user.email", "workflow-tests@thinkrail.test");
	git("config", "user.name", "ThinkRail Workflow Tests");
	if (typeof seed === "function") seed(cwd);
	else seedKind(cwd, seed);
	git("add", "-A");
	git("commit", "-m", "seed", "--allow-empty");
	return cwd;
}

function seedKind(cwd: string, kind: WorkspaceKind): void {
	switch (kind) {
		case "empty":
			writeFileSync(join(cwd, "README.md"), "# blank-slate\n\nAn empty project.\n");
			return;
		case "code-only": {
			// The same shape the import @agent e2e uses: an explicit AGENTS.md + a small two-module source
			// tree with a clear boundary, so import-style flows can proceed from the files alone.
			writeFileSync(
				join(cwd, "AGENTS.md"),
				[
					"# acme-widgets",
					"",
					"acme-widgets is a small command-line tool that batch-resizes images.",
					"",
					"## Modules",
					"- `src/cli` — argument parsing and the command entry point.",
					"- `src/resize` — the image-resizing pipeline (the core logic).",
					"",
					"`cli` calls `resize`; `resize` never imports `cli`.",
					"",
				].join("\n"),
			);
			mkdirSync(join(cwd, "src", "cli"), { recursive: true });
			mkdirSync(join(cwd, "src", "resize"), { recursive: true });
			writeFileSync(
				join(cwd, "src", "cli", "index.ts"),
				'import { resize } from "../resize";\n\nexport function main(argv: string[]): void {\n\tresize(argv);\n}\n',
			);
			writeFileSync(
				join(cwd, "src", "resize", "index.ts"),
				"// The core domain. Never imports from cli.\nexport function resize(files: string[]): void {\n\tvoid files;\n}\n",
			);
			return;
		}
		case "specced": {
			writeFileSync(
				join(cwd, "SPEC.md"),
				"---\nid: acme-root\ntype: goal-and-requirements\ntitle: Acme Widgets\n---\n\n## Goal\n\nA small CLI that batch-resizes images.\n",
			);
			mkdirSync(join(cwd, "src", "resize"), { recursive: true });
			writeFileSync(
				join(cwd, "src", "resize", "SPEC.md"),
				"---\nid: acme-resize\ntype: module-design\nstatus: active\ntitle: resize — the pipeline\nparent: acme-root\n---\n\n## Responsibility\n\nThe image-resizing pipeline.\n",
			);
			writeFileSync(
				join(cwd, "src", "resize", "index.ts"),
				"export function resize(files: string[]): void {\n\tvoid files;\n}\n",
			);
			return;
		}
	}
}
