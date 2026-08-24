import { readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type {
	BranchList,
	GitCommit,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	GitStatus,
	Workspace,
} from "@thinkrail/contracts";
import { loadProjects, loadWorkspaces } from "../persistence";
import { changedFileArgs, type DiffRange, diffBaseRef, resolveDiffRange } from "./diffScope";
import { git, gitAsync } from "./gitExec";

function workspace(workspaceId: string): Workspace {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);
	return ws;
}

export function gitCommitPaths(
	workspaceId: string,
	message: string,
	paths: string[],
): { sha: string } | null {
	if (paths.length === 0) return null;
	const cwd = workspace(workspaceId).worktreePath;
	const unmerged = git(cwd, ["ls-files", "-u"]);
	if (!unmerged.ok || unmerged.out) return null;
	const indexOut = git(cwd, ["rev-parse", "--git-path", "index"]);
	if (!indexOut.ok || !indexOut.out) return null;
	const indexPath = isAbsolute(indexOut.out) ? indexOut.out : resolve(cwd, indexOut.out);
	let saved: Buffer | null = null;
	try {
		saved = readFileSync(indexPath);
	} catch {
		saved = null;
	}
	const restore = (): null => {
		try {
			if (saved === null) rmSync(indexPath, { force: true });
			else writeFileSync(indexPath, saved);
		} catch {}
		return null;
	};
	if (!git(cwd, ["--literal-pathspecs", "add", "-A", "--", ...paths]).ok) return restore();
	if (git(cwd, ["--literal-pathspecs", "diff", "--cached", "--quiet", "--", ...paths]).ok)
		return restore();
	if (!git(cwd, ["--literal-pathspecs", "commit", "--no-verify", "-m", message, "--", ...paths]).ok)
		return restore();
	const head = git(cwd, ["rev-parse", "HEAD"]);
	if (!head.ok) return null;
	return { sha: head.out };
}

export function gitHeadSha(workspaceId: string): string | null {
	const cwd = workspace(workspaceId).worktreePath;
	const head = git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
	return head.ok && head.out ? head.out : null;
}

function lines(out: string): string[] {
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

export function listBranches(projectId: string): BranchList {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);
	const repo = project.path;

	const local = lines(git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).out);
	const remote = lines(
		git(repo, ["for-each-ref", "--format=%(refname:short)\t%(symref)", "refs/remotes/origin"]).out,
	)
		.map((line) => line.split("\t"))
		.filter((parts) => !parts[1])
		.map((parts) => parts[0] ?? "")
		.filter(Boolean);

	return { local, remote, defaultBranch: resolveDefaultBranch(repo) };
}

export function resolveDefaultBranch(repoPath: string): string {
	const head = git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
	if (head.ok && head.out) return head.out;
	if (git(repoPath, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"]).ok)
		return "origin/main";
	return currentBranch(repoPath);
}

export function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

export function tryCurrentBranch(repoPath: string): string | null {
	const head = git(repoPath, ["symbolic-ref", "--short", "HEAD"]);
	if (head.ok && head.out) return head.out;
	const topLevel = git(repoPath, ["rev-parse", "--show-toplevel"]);
	return topLevel.ok && canonicalPath(topLevel.out) === canonicalPath(repoPath) ? "HEAD" : null;
}

export function currentBranch(repoPath: string): string {
	return tryCurrentBranch(repoPath) ?? "HEAD";
}

export async function prefetchBranch(
	projectId: string,
	ref: string,
): Promise<{ ok: boolean; moved: boolean }> {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project || !ref.startsWith("origin/")) return { ok: false, moved: false };
	const revParse = () =>
		git(project.path, [
			"rev-parse",
			"--verify",
			"--quiet",
			"--end-of-options",
			`refs/remotes/${ref}`,
		]);
	const before = revParse();
	const result = await gitAsync(project.path, [
		"fetch",
		"origin",
		"--",
		ref.slice("origin/".length),
	]);
	if (!result.ok) return { ok: false, moved: false };
	const after = revParse();
	const moved = after.ok && after.out !== "" && (!before.ok || before.out !== after.out);
	return { ok: true, moved };
}

function mapStatus(code: string): GitFileStatus {
	if (code.startsWith("A") || code.startsWith("C")) return "added";
	if (code.startsWith("D")) return "deleted";
	if (code.startsWith("R")) return "renamed";
	return "modified";
}

export function numstatPath(raw: string): string {
	if (!raw.includes("=>")) return raw;
	const brace = raw.match(/^(.*)\{.* => (.*)\}(.*)$/);
	if (brace) return `${brace[1]}${brace[2]}${brace[3]}`.replace(/\/\//g, "/");
	const arrow = raw.match(/ => (.*)$/);
	return arrow ? (arrow[1] ?? raw) : raw;
}

function numstat(
	worktreePath: string,
	range: DiffRange,
): Map<string, { added: number; removed: number }> {
	const counts = new Map<string, { added: number; removed: number }>();
	const out = git(worktreePath, changedFileArgs(range, "--numstat"));
	if (!out.ok) throw diffFailure(out.err);
	if (!out.out) return counts;
	for (const line of out.out.split("\n")) {
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const added = Number(parts[0]);
		const removed = Number(parts[1]);
		if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
		counts.set(numstatPath(parts.slice(2).join("\t")), { added, removed });
	}
	return counts;
}

function lineCount(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

const UNTRACKED_COUNT_MAX_BYTES = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8192;

function untrackedAdded(worktreePath: string, path: string): number | undefined {
	try {
		const abs = resolve(worktreePath, path);
		if (statSync(abs).size > UNTRACKED_COUNT_MAX_BYTES) return undefined;
		const buf = readFileSync(abs);
		if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return undefined;
		return lineCount(buf.toString("utf8"));
	} catch {
		return undefined;
	}
}

function diffFailure(stderr: string): Error {
	return new Error(`Could not read the changed files: ${stderr || "git failed"}`);
}

export function gitStatus(workspaceId: string, scope?: GitDiffScope): GitStatus {
	const ws = workspace(workspaceId);
	const range = resolveDiffRange(ws, scope);
	const changes: GitFileChange[] = [];
	const counts = numstat(ws.worktreePath, range);

	const tracked = git(ws.worktreePath, changedFileArgs(range, "--name-status"));
	if (!tracked.ok) throw diffFailure(tracked.err);
	if (tracked.out) {
		for (const line of tracked.out.split("\n")) {
			const parts = line.split("\t");
			const code = parts[0] ?? "";
			const path = parts.length > 2 ? parts[parts.length - 1] : parts[1];
			if (path) changes.push({ path, status: mapStatus(code), ...counts.get(path) });
		}
	}

	if (range.untracked) {
		const untracked = git(ws.worktreePath, ["ls-files", "--others", "--exclude-standard"]);
		if (untracked.ok && untracked.out) {
			for (const path of untracked.out.split("\n")) {
				if (!path) continue;
				const added = untrackedAdded(ws.worktreePath, path);
				changes.push({
					path,
					status: "untracked",
					...(added !== undefined && { added, removed: 0 }),
				});
			}
		}
	}

	changes.sort((a, b) => a.path.localeCompare(b.path));
	const branch =
		ws.kind === "default" || ws.kind === "external" ? currentBranch(ws.worktreePath) : ws.branch;
	return { branch, changes };
}

export function readBlobAt(worktreePath: string, ref: string, path: string): string | null {
	const shown = git(worktreePath, ["show", "--end-of-options", `${ref}:${path}`], { raw: true });
	if (shown.ok) return shown.out;
	if (!/does not exist in|exists on disk, but not in/.test(shown.err)) {
		console.warn(`git show ${ref}:${path} failed: ${shown.err || "unknown error"}`);
	}
	return null;
}

function showBlob(worktreePath: string, ref: string, path: string): string {
	return readBlobAt(worktreePath, ref, path) ?? "";
}

export function gitDiffFile(
	workspaceId: string,
	path: string,
	scope?: GitDiffScope,
): { original: string; modified: string } {
	const ws = workspace(workspaceId);
	const range = resolveDiffRange(ws, scope);

	const abs = resolve(ws.worktreePath, path);
	const rel = relative(ws.worktreePath, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the worktree");

	const original = range.originalRef ? showBlob(ws.worktreePath, range.originalRef, path) : "";

	if (range.modifiedRef)
		return { original, modified: showBlob(ws.worktreePath, range.modifiedRef, path) };
	let modified = "";
	try {
		modified = readFileSync(abs, "utf8");
	} catch {}
	return { original, modified };
}

const COMMIT_LIST_MAX = 200;
const LOG_SEP = "\u0000";

const LOG_LEADING_FIELDS = 4;

function plainText(raw: string): string {
	let out = "";
	for (const char of raw) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) continue; // C0 controls + DEL
		if (code >= 0x80 && code <= 0x9f) continue; // C1 controls
		if (code >= 0x200b && code <= 0x200f) continue; // zero-width + LRM/RLM
		if (code >= 0x202a && code <= 0x202e) continue; // bidi embeddings/overrides
		if (code >= 0x2066 && code <= 0x2069) continue; // bidi isolates
		if (code === 0x061c) continue; // Arabic letter mark
		if (code === 0xfeff) continue; // BOM / zero-width no-break space
		if (code === 0x00ad) continue; // soft hyphen
		out += char;
	}
	return out;
}

export function listCommits(workspaceId: string): { commits: GitCommit[] } {
	const ws = workspace(workspaceId);
	const log = git(ws.worktreePath, [
		"log",
		`--max-count=${COMMIT_LIST_MAX}`,
		`--format=%H%x00%h%x00%cI%x00%an%x00%s`,
		"--end-of-options",
		`${diffBaseRef(ws)}..HEAD`,
		"--",
	]);
	if (!log.ok || !log.out) return { commits: [] };
	const commits: GitCommit[] = [];
	for (const line of log.out.split("\n")) {
		const parts = line.split(LOG_SEP);
		const [sha, shortSha, committedAt, author] = parts;
		if (!sha || !shortSha) continue;
		const subject = parts.slice(LOG_LEADING_FIELDS).join(LOG_SEP);
		commits.push({
			sha,
			shortSha,
			subject: plainText(subject),
			author: plainText(author ?? ""),
			committedAt: committedAt ?? "",
		});
	}
	return { commits };
}
