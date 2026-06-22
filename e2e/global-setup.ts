import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_DATA_DIR, E2E_FIXTURE_REPO } from "./fixtures/paths";

/** Fresh, isolated state dir + a throwaway git repo to open as a project. (Runs under node, not bun.) */
export default function globalSetup(): void {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	mkdirSync(E2E_FIXTURE_REPO, { recursive: true });

	const git = (...args: string[]) =>
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, ...args], { stdio: "ignore" });
	git("init", "-b", "main");
	git("config", "user.email", "e2e@thinkrail.test");
	git("config", "user.name", "ThinkRail E2E");
	writeFileSync(join(E2E_FIXTURE_REPO, "README.md"), "# sample-project\n");
	git("add", "-A");
	git("commit", "-m", "init");
}
