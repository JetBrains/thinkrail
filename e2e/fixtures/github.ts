import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeGhScenario } from "./fakeGh";
import { gitAs } from "./git";
import { E2E_FAKE_BIN_DIR, E2E_GH_LOG, E2E_GH_SCENARIO } from "./paths";

export type { FakeGhScenario, FakePr } from "./fakeGh";

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function githubOrigin(
	worktree: string,
	repository = "acme/sample",
): { bare: string; dispose: () => void } {
	const bare = mkdtempSync(join(tmpdir(), "thinkrail-gh-origin-"));
	gitAs(bare, "init", "-q", "--bare");
	gitAs(worktree, "remote", "add", "origin", `git@github.com:${repository}.git`);
	gitAs(
		worktree,
		"config",
		"core.sshCommand",
		`${shellQuote(join(E2E_FAKE_BIN_DIR, "github-ssh"))} ${shellQuote(bare)}`,
	);
	gitAs(worktree, "config", "ssh.variant", "simple");
	return { bare, dispose: () => rmSync(bare, { recursive: true, force: true }) };
}

export function writeGhScenario(scenario: FakeGhScenario): void {
	writeFileSync(E2E_GH_SCENARIO, `${JSON.stringify(scenario, null, 2)}\n`);
}

export function readGhScenario(): FakeGhScenario {
	return JSON.parse(readFileSync(E2E_GH_SCENARIO, "utf8")) as FakeGhScenario;
}

export function ghCalls(): string[][] {
	if (!existsSync(E2E_GH_LOG)) return [];
	return readFileSync(E2E_GH_LOG, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as string[]);
}

export function ghMutations(): string[][] {
	return ghCalls().filter(
		(argv) => argv[0] === "pr" && ["ready", "merge", "reopen"].includes(argv[1] ?? ""),
	);
}

export function remoteHead(bare: string, branch: string): string {
	return gitAs(bare, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`);
}
