import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { git } from "./gitExec";

type HeadFile = { ref: "branch"; name: string } | { ref: "detached" } | { ref: "reftable" };

const BRANCH_REF_PREFIX = "refs/heads/";
const BRANCH_HEAD = /^ref: refs\/heads\/(.+)$/;
const REFTABLE_STUB = ".invalid";
const SYMBOLIC_HEAD_ARGS = ["symbolic-ref", "-q", "HEAD"];

export function parseHead(text: string): HeadFile {
	const name = BRANCH_HEAD.exec(text.trim())?.[1];
	if (!name) return { ref: "detached" };
	return name === REFTABLE_STUB ? { ref: "reftable" } : { ref: "branch", name };
}

function worktreeGitDir(worktreePath: string): string | null {
	const dotGit = join(worktreePath, ".git");
	try {
		if (statSync(dotGit).isDirectory()) return dotGit;
		const target = /^gitdir:\s*(.+)$/.exec(readFileSync(dotGit, "utf8").trim())?.[1];
		if (!target) return null;
		return resolve(worktreePath, target);
	} catch {
		return null;
	}
}

function readHeadFile(worktreePath: string): HeadFile | null {
	const gitDir = worktreeGitDir(worktreePath);
	if (!gitDir) return null;
	try {
		return parseHead(readFileSync(join(gitDir, "HEAD"), "utf8"));
	} catch {
		return null;
	}
}

export function headBranchAt(worktreePath: string): string | null {
	const head = readHeadFile(worktreePath);
	if (head?.ref === "branch") return head.name;
	if (head?.ref !== "reftable") return null;
	const result = git(worktreePath, SYMBOLIC_HEAD_ARGS);
	return result.ok && result.out.startsWith(BRANCH_REF_PREFIX)
		? result.out.slice(BRANCH_REF_PREFIX.length)
		: null;
}
