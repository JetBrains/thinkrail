import { mkdirSync } from "node:fs";
import { delimiter } from "node:path";
import { chatsRoot } from "../workspaces";

/**
 * Git must never walk up out of a chat folder into whatever repository happens to enclose the data
 * dir: the chats root joins `GIT_CEILING_DIRECTORIES` for this process and every child it spawns.
 */
export function applyGitCeiling(env: NodeJS.ProcessEnv = process.env): void {
	const root = chatsRoot();
	mkdirSync(root, { recursive: true });
	const current = (env.GIT_CEILING_DIRECTORIES ?? "").split(delimiter).filter(Boolean);
	if (!current.includes(root)) env.GIT_CEILING_DIRECTORIES = [...current, root].join(delimiter);
}
