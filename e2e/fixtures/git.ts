import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Runs git in `cwd`; on failure, the thrown error carries git's captured stderr. */
export function git(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-C", cwd, ...args]);
}

/** Runs git in `cwd`, discarding its output entirely — for calls a caller expects may fail. */
export function gitQuiet(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

/** Runs git in `cwd`, returning its raw utf8 stdout. */
export function gitText(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

/** Runs git in `cwd` under a throwaway e2e identity, returning trimmed utf8 stdout. */
export function gitAs(cwd: string, ...args: string[]): string {
	return execFileSync(
		"git",
		["-C", cwd, "-c", "user.email=e2e@thinkrail.test", "-c", "user.name=e2e", ...args],
		{ encoding: "utf8" },
	).trim();
}

/** One real commit in the worktree (the shape artifacts.ts leaves), returning its sha. */
export function commitFile(
	worktree: string,
	path: string,
	content: string,
	subject: string,
): string {
	writeFileSync(join(worktree, path), content);
	gitAs(worktree, "add", "--", path);
	gitAs(worktree, "commit", "--no-verify", "-m", subject);
	return gitAs(worktree, "rev-parse", "HEAD");
}
