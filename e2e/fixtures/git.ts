import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function git(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-C", cwd, ...args]);
}

export function gitQuiet(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

export function gitText(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

export function gitAs(cwd: string, ...args: string[]): string {
	return execFileSync(
		"git",
		["-C", cwd, "-c", "user.email=e2e@thinkrail.test", "-c", "user.name=e2e", ...args],
		{ encoding: "utf8" },
	).trim();
}

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
