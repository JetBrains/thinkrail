import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type ChildTranscriptLocator = (parent: {
	sessionId: string;
	cwd: string;
}) => Promise<readonly string[]>;

const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const VANILLA_DELEGATION_SCOPE = "default";

export function defaultSessionsRoot(): string {
	return join(getAgentDir(), "sessions");
}

export async function listJsonlFiles(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir))
			.filter((name) => name.endsWith(".jsonl"))
			.sort()
			.map((name) => join(dir, name));
	} catch {
		return [];
	}
}

export async function listSessionFiles(root: string): Promise<string[]> {
	let dirs: string[];
	try {
		dirs = (await readdir(root, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => entry.name)
			.sort();
	} catch {
		return [];
	}
	const files = await Promise.all(dirs.map((dir) => listJsonlFiles(join(root, dir))));
	return files.flat();
}

async function isDirectory(path: string): Promise<boolean> {
	return stat(path).then(
		(entry) => entry.isDirectory(),
		() => false,
	);
}

export function vanillaChildTranscriptDirs(agentDir?: string): ChildTranscriptLocator {
	return async ({ sessionId }) => {
		if (!SESSION_ID.test(sessionId)) return [];
		const dir = join(agentDir ?? getAgentDir(), "delegation", VANILLA_DELEGATION_SCOPE, sessionId);
		return (await isDirectory(dir)) ? [dir] : [];
	};
}
