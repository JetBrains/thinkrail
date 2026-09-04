import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitQuiet } from "../../fixtures/git";
import { E2E_DATA_DIR } from "../../fixtures/paths";

export type WorkspaceKind = "empty" | "code-only" | "specced";
export type WorkspaceSeed = WorkspaceKind | ((cwd: string) => void);

let counter = 0;

export function seedWorkspace(seed: WorkspaceSeed): string {
	const cwd = join(E2E_DATA_DIR, `workflow-ws-${process.pid}-${++counter}`);
	mkdirSync(cwd, { recursive: true });
	gitQuiet(cwd, "init", "-b", "main");
	gitQuiet(cwd, "config", "user.email", "workflow-tests@thinkrail.test");
	gitQuiet(cwd, "config", "user.name", "ThinkRail Workflow Tests");
	gitQuiet(cwd, "config", "commit.gpgsign", "false");
	if (typeof seed === "function") seed(cwd);
	else seedKind(cwd, seed);
	gitQuiet(cwd, "add", "-A");
	gitQuiet(cwd, "commit", "-m", "seed", "--allow-empty");
	return cwd;
}

function seedKind(cwd: string, kind: WorkspaceKind): void {
	switch (kind) {
		case "empty":
			writeFileSync(join(cwd, "README.md"), "# blank-slate\n\nAn empty project.\n");
			return;
		case "code-only": {
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
