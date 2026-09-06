import { readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type {
	BranchList,
	GitCommit,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	GitStatus,
	RemoteBranchGroup,
	Workspace,
} from "@thinkrail/contracts";
import { logger } from "../log";
import { loadProjects, loadWorkspaces } from "../persistence";
import { changedFileArgs, type DiffRange, diffBaseRef, resolveDiffRange } from "./diffScope";
import { git, gitAsync, nonInteractiveGitEnv } from "./gitExec";
import { isSafeRef, remoteNameOf } from "./refs";

const log = logger("git");

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

const LOCAL_REF_PREFIX = "refs/heads/";
const REMOTE_REF_PREFIX = "refs/remotes/";

function refWithin(ref: string, prefix: string): string | null {
	if (!ref.startsWith(prefix)) return null;
	const name = ref.slice(prefix.length);
	return name || null;
}

function groupRemoteRefs(refs: string[], remotes: string[]): RemoteBranchGroup[] {
	const groups = new Map<string | null, RemoteBranchGroup>();
	for (const ref of refs) {
		const remote = remoteNameOf(ref, remotes);
		const branch = remote ? ref.slice(`${remote}/`.length) : ref;
		const group = groups.get(remote);
		if (group) group.branches.push({ ref, branch });
		else groups.set(remote, { remote, branches: [{ ref, branch }] });
	}
	return [...groups.values()];
}

export async function listBranches(projectId: string): Promise<BranchList> {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project) throw new Error(`Unknown project: ${projectId}`);
	const repo = project.path;

	const [localRefs, remoteRefs, remoteNames] = await Promise.all([
		gitAsync(repo, ["for-each-ref", "--format=%(refname)", "refs/heads"]),
		gitAsync(repo, ["for-each-ref", "--format=%(refname)\t%(symref)", "refs/remotes"]),
		gitAsync(repo, ["remote"]),
	]);
	if (!localRefs.ok)
		throw new Error(`Could not list local branches: ${localRefs.err || "git failed"}`);
	if (!remoteRefs.ok)
		throw new Error(`Could not list remote branches: ${remoteRefs.err || "git failed"}`);
	if (!remoteNames.ok)
		throw new Error(`Could not list remotes: ${remoteNames.err || "git failed"}`);
	const local = lines(localRefs.out)
		.map((ref) => refWithin(ref, LOCAL_REF_PREFIX) ?? "")
		.filter(Boolean);
	const remote = lines(remoteRefs.out)
		.map((line) => line.split("\t"))
		.filter((parts) => !parts[1])
		.map((parts) => refWithin(parts[0] ?? "", REMOTE_REF_PREFIX) ?? "")
		.filter(Boolean);

	return {
		local,
		remote,
		remoteGroups: groupRemoteRefs(remote, lines(remoteNames.out)),
		defaultBranch: resolveDefaultBranch(repo),
	};
}

export function listRemotes(repoPath: string): string[] {
	return lines(git(repoPath, ["remote"]).out);
}

export function resolveDefaultBranch(repoPath: string): string {
	const originHeadRef = `${REMOTE_REF_PREFIX}origin/HEAD`;
	const originHead = git(repoPath, ["symbolic-ref", originHeadRef]);
	const originDefault = originHead.ok ? refWithin(originHead.out, REMOTE_REF_PREFIX) : null;
	if (originDefault) return originDefault;
	const rows = lines(
		git(repoPath, ["for-each-ref", "--format=%(refname)\t%(symref)", "refs/remotes"]).out,
	).map((line) => line.split("\t"));
	const otherHead = rows.find(
		([ref, symref]) =>
			ref !== originHeadRef &&
			ref?.startsWith(REMOTE_REF_PREFIX) &&
			ref.endsWith("/HEAD") &&
			symref?.startsWith(REMOTE_REF_PREFIX),
	)?.[1];
	const otherDefault = refWithin(otherHead ?? "", REMOTE_REF_PREFIX);
	if (otherDefault) return otherDefault;
	if (rows.some(([ref, symref]) => ref === `${REMOTE_REF_PREFIX}origin/main` && !symref))
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

export function remoteRefOid(repoPath: string, ref: string): string | null {
	if (!isSafeRef(ref)) return null;
	const remote = `${REMOTE_REF_PREFIX}${ref}`;
	const result = git(repoPath, ["rev-parse", "--verify", "--quiet", "--end-of-options", remote]);
	return result.ok && result.out !== "" ? result.out : null;
}

export async function prefetchBranch(
	projectId: string,
	ref: string,
): Promise<{ ok: boolean; moved: boolean }> {
	const project = loadProjects().find((p) => p.id === projectId);
	if (!project || !isSafeRef(ref)) return { ok: false, moved: false };
	const remoteName = remoteNameOf(ref, listRemotes(project.path));
	if (!remoteName) return { ok: false, moved: false };
	const before = remoteRefOid(project.path, ref);
	const result = await gitAsync(
		project.path,
		["fetch", remoteName, "--", ref.slice(`${remoteName}/`.length)],
		{ network: true },
	);
	const after = remoteRefOid(project.path, ref);
	const moved = after !== null && after !== before;
	return { ok: result.ok, moved };
}

function mapStatus(code: string): GitFileStatus {
	if (code.startsWith("A") || code.startsWith("C")) return "added";
	if (code.startsWith("D")) return "deleted";
	if (code.startsWith("R")) return "renamed";
	return "modified";
}

async function numstat(
	worktreePath: string,
	range: DiffRange,
): Promise<Map<string, { added: number; removed: number }>> {
	const counts = new Map<string, { added: number; removed: number }>();
	const out = await gitAsync(worktreePath, changedFileArgs(range, "--numstat", true), {
		raw: true,
	});
	if (!out.ok) throw diffFailure(out.err);
	const fields = nulFields(out.out);
	for (let index = 0; index < fields.length; ) {
		const header = fields[index++] ?? "";
		const firstTab = header.indexOf("\t");
		const secondTab = firstTab < 0 ? -1 : header.indexOf("\t", firstTab + 1);
		if (firstTab < 0 || secondTab < 0) continue;
		const added = Number(header.slice(0, firstTab));
		const removed = Number(header.slice(firstTab + 1, secondTab));
		let path = header.slice(secondTab + 1);
		if (!path) {
			index++;
			path = fields[index++] ?? "";
		}
		if (!path || !Number.isFinite(added) || !Number.isFinite(removed)) continue;
		counts.set(path, { added, removed });
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

function nulFields(output: string): string[] {
	const fields = output.split("\0");
	if (fields.at(-1) === "") fields.pop();
	return fields;
}

function parseNameStatus(output: string): Array<{ code: string; path: string }> {
	const fields = nulFields(output);
	const parsed: Array<{ code: string; path: string }> = [];
	for (let index = 0; index < fields.length; ) {
		const code = fields[index++] ?? "";
		let path = fields[index++] ?? "";
		if (code.startsWith("R") || code.startsWith("C")) path = fields[index++] ?? "";
		if (path) parsed.push({ code, path });
	}
	return parsed;
}

export function gitUncommittedPaths(workspaceId: string): string[] {
	const cwd = workspace(workspaceId).worktreePath;
	const tracked = git(
		cwd,
		["diff", "--name-only", "-z", "--no-ext-diff", "--end-of-options", "HEAD", "--"],
		{ raw: true },
	);
	if (!tracked.ok) throw diffFailure(tracked.err);
	const untracked = git(cwd, ["ls-files", "-z", "--others", "--exclude-standard"], {
		raw: true,
	});
	if (!untracked.ok) throw diffFailure(untracked.err);
	return [...new Set([...nulFields(tracked.out), ...nulFields(untracked.out)])].sort();
}

export async function gitStatus(workspaceId: string, scope?: GitDiffScope): Promise<GitStatus> {
	const ws = workspace(workspaceId);
	const range = await resolveDiffRange(ws, scope);
	const changes: GitFileChange[] = [];
	const [counts, tracked] = await Promise.all([
		numstat(ws.worktreePath, range),
		gitAsync(ws.worktreePath, changedFileArgs(range, "--name-status", true), { raw: true }),
	]);
	if (!tracked.ok) throw diffFailure(tracked.err);
	for (const { code, path } of parseNameStatus(tracked.out)) {
		changes.push({ path, status: mapStatus(code), ...counts.get(path) });
	}

	if (range.untracked) {
		const untracked = await gitAsync(
			ws.worktreePath,
			["ls-files", "-z", "--others", "--exclude-standard"],
			{ raw: true },
		);
		if (!untracked.ok) throw diffFailure(untracked.err);
		for (const path of nulFields(untracked.out)) {
			if (!path) continue;
			const added = untrackedAdded(ws.worktreePath, path);
			changes.push({
				path,
				status: "untracked",
				...(added !== undefined && { added, removed: 0 }),
			});
		}
	}

	changes.sort((a, b) => a.path.localeCompare(b.path));
	const branch =
		ws.kind === "default" || ws.kind === "external" ? currentBranch(ws.worktreePath) : ws.branch;
	return { branch, changes };
}

export function readBlobAt(worktreePath: string, ref: string, path: string): string | null {
	return blobFrom(git(worktreePath, ["show", "--end-of-options", `${ref}:${path}`], { raw: true }));
}

function blobIsMissing(stderr: string): boolean {
	return /does not exist in|exists on disk, but not in/.test(stderr);
}

function blobFrom(shown: { ok: boolean; out: string; err: string }): string | null {
	if (shown.ok) return shown.out;
	if (!blobIsMissing(shown.err)) log.warn("git blob read failed");
	return null;
}

async function showBlob(worktreePath: string, ref: string, path: string): Promise<string> {
	const shown = await gitAsync(worktreePath, ["show", "--end-of-options", `${ref}:${path}`], {
		raw: true,
		env: { ...nonInteractiveGitEnv(), LC_ALL: "C" },
	});
	if (shown.ok) return shown.out;
	if (shown.failure) throw new Error(`Could not read the file diff: ${shown.err || "git failed"}`);
	if (blobIsMissing(shown.err)) return "";
	throw new Error(`Could not read the file diff: ${shown.err || "git failed"}`);
}

export async function gitDiffFile(
	workspaceId: string,
	path: string,
	scope?: GitDiffScope,
): Promise<{ original: string; modified: string }> {
	const ws = workspace(workspaceId);
	const range = await resolveDiffRange(ws, scope);

	const abs = resolve(ws.worktreePath, path);
	const rel = relative(ws.worktreePath, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the worktree");

	const original = range.originalRef
		? await showBlob(ws.worktreePath, range.originalRef, path)
		: "";

	if (range.modifiedRef)
		return { original, modified: await showBlob(ws.worktreePath, range.modifiedRef, path) };
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

export async function listCommits(workspaceId: string): Promise<{ commits: GitCommit[] }> {
	const ws = workspace(workspaceId);
	const log = await gitAsync(ws.worktreePath, [
		"log",
		`--max-count=${COMMIT_LIST_MAX}`,
		`--format=%H%x00%h%x00%cI%x00%an%x00%s`,
		"--end-of-options",
		`${diffBaseRef(ws)}..HEAD`,
		"--",
	]);
	if (log.failure) throw new Error(`Could not list commits: ${log.err || "git failed"}`);
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

export async function countUnpushedCommits(
	worktreePath: string,
	branch: string,
): Promise<number | null> {
	const counted = await gitAsync(worktreePath, [
		"rev-list",
		"--count",
		"--end-of-options",
		`origin/${branch}..HEAD`,
		"--",
	]);
	if (counted.failure)
		throw new Error(`Could not count unpushed commits: ${counted.err || "git failed"}`);
	if (!counted.ok) {
		if (remoteRefOid(worktreePath, `origin/${branch}`) === null) return null;
		throw new Error(`Could not count unpushed commits: ${counted.err || "git failed"}`);
	}
	const count = Number(counted.out);
	return Number.isSafeInteger(count) && count >= 0 ? count : null;
}
