import { mkdirSync } from "node:fs";
import { delimiter } from "node:path";
import { containersRoot } from "../containers";
import { chatsRoot } from "../workspaces";

/**
 * Git must never walk up out of a chat folder or a container's home into whatever repository happens to
 * enclose the data dir: both roots join `GIT_CEILING_DIRECTORIES` for this process and every child it spawns.
 */
export function applyGitCeiling(env: NodeJS.ProcessEnv = process.env): void {
	const current = (env.GIT_CEILING_DIRECTORIES ?? "").split(delimiter).filter(Boolean);
	for (const root of [chatsRoot(), containersRoot()]) {
		mkdirSync(root, { recursive: true });
		if (!current.includes(root)) current.push(root);
	}
	env.GIT_CEILING_DIRECTORIES = current.join(delimiter);
}
