import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import {
	gitAsync,
	isSafeRef,
	listRemotes,
	nonInteractiveGitEnv,
	remoteTrackingRef,
	throwOnTimeout,
} from "../git";
import { logger } from "../log";
import { dataDir } from "../persistence";

const log = logger("workspaces");

const KEEP_PREVIEWS_PER_PROJECT = 4;
const PRUNE_GRACE_MS = 10 * 60_000;
const inFlight = new Map<string, Promise<string | null>>();

export interface RefPreviewProject {
	id: string;
	path: string;
}

export function refPreviewRoot(projectId: string): string {
	return join(dataDir(), "cache", "ref-previews", projectId);
}

async function resolveRefCommit(repoPath: string, ref: string): Promise<string | null> {
	const target = remoteTrackingRef(ref, listRemotes(repoPath)) ?? ref;
	const result = throwOnTimeout(
		await gitAsync(repoPath, [
			"rev-parse",
			"--verify",
			"--quiet",
			"--end-of-options",
			`${target}^{commit}`,
		]),
		`resolve ${ref}`,
	);
	return result.ok && result.out ? result.out : null;
}

async function existingRoots(repoPath: string, sha: string, roots: readonly string[]) {
	const result = throwOnTimeout(
		await gitAsync(repoPath, ["ls-tree", "-d", "--name-only", "-z", sha, "--", ...roots], {
			raw: true,
		}),
		`list ${sha}`,
	);
	if (!result.ok) throw new Error(result.err || `git ls-tree ${sha} failed`);
	const present = new Set(result.out.split("\0").filter(Boolean));
	return roots.filter((root) => present.has(root));
}

async function extract(repoPath: string, sha: string, roots: readonly string[], dest: string) {
	const staging = `${dest}.tmp-${randomUUID()}`;
	await mkdir(join(staging, ".git"), { recursive: true });
	const env = { ...nonInteractiveGitEnv(), GIT_INDEX_FILE: join(staging, ".git", "index") };
	try {
		for (const root of await existingRoots(repoPath, sha, roots)) {
			const read = throwOnTimeout(
				await gitAsync(repoPath, ["read-tree", `--prefix=${root}/`, `${sha}:${root}`], { env }),
				`read ${root} at ${sha}`,
			);
			if (!read.ok) throw new Error(read.err || `git read-tree ${root} failed`);
		}
		const checkout = throwOnTimeout(
			await gitAsync(repoPath, ["checkout-index", "--all", `--prefix=${staging}/`], { env }),
			`extract ${sha}`,
		);
		if (!checkout.ok) throw new Error(checkout.err || "git checkout-index failed");
		await rm(env.GIT_INDEX_FILE, { force: true });
		try {
			await rename(staging, dest);
		} catch (err) {
			if (!existsSync(dest)) throw err;
		}
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function pruneOlder(root: string, keep: string) {
	const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
	const now = Date.now();
	const previews = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && entry.name !== keep)
			.map(async (entry) => ({
				path: join(root, entry.name),
				staging: entry.name.includes(".tmp-"),
				at: (await stat(join(root, entry.name)).catch(() => null))?.mtimeMs ?? 0,
			})),
	);
	const settled = previews.filter((p) => !p.staging).sort((a, b) => b.at - a.at);
	const stale = [
		...settled.slice(KEEP_PREVIEWS_PER_PROJECT - 1),
		...previews.filter((p) => p.staging),
	].filter((p) => now - p.at > PRUNE_GRACE_MS);
	for (const { path } of stale) await rm(path, { recursive: true, force: true });
}

async function materialize(
	project: RefPreviewProject,
	ref: string,
	roots: readonly string[],
): Promise<string | null> {
	const sha = await resolveRefCommit(project.path, ref);
	if (!sha) return null;
	const root = refPreviewRoot(project.id);
	const dest = join(root, sha);
	if (existsSync(dest)) {
		const now = new Date();
		await utimes(dest, now, now).catch(() => {});
		return dest;
	}
	const key = `${project.id}\0${sha}`;
	let pending = inFlight.get(key);
	if (!pending) {
		pending = (async () => {
			await mkdir(root, { recursive: true });
			await extract(project.path, sha, roots, dest);
			await pruneOlder(root, sha);
			return dest;
		})().finally(() => inFlight.delete(key));
		inFlight.set(key, pending);
	}
	return pending;
}

/**
 * A read-only folder holding only `roots` as they are at `ref` — what a worktree cut from it would
 * contain there — or `null` when the ref does not resolve or cannot be extracted.
 */
export async function previewRefPaths(
	project: RefPreviewProject,
	ref: string,
	roots: readonly string[],
): Promise<string | null> {
	if (!isSafeRef(ref)) return null;
	try {
		return await materialize(project, ref, roots);
	} catch (err) {
		log.warn(`could not preview ${ref} for project ${project.id}`, err);
		return null;
	}
}
