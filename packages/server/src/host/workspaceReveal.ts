import { isAbsolute } from "node:path";
import type { Ack, WsParams } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { revealInFileManager, revealItemInFileManager } from "../editors";
import { resolveWorktreeFile } from "../fs";
import { getWorkspace } from "../workspaces";

export function revealWorkspace(
	params: WsParams<"workspace.reveal">,
	revealItem: (path: string) => void = revealItemInFileManager,
	revealFolder: (path: string) => void = revealInFileManager,
): Ack {
	if (params.path === undefined) {
		revealFolder(getWorkspace(params.id).worktreePath);
	} else {
		try {
			if (typeof params.path !== "string" || params.path.length === 0 || isAbsolute(params.path)) {
				throw new Error("A nonempty worktree-relative path is required.");
			}
			revealItem(resolveWorktreeFile(params.id, params.path));
		} catch (error) {
			throw new CodedError(
				"FILE_REVEAL_FAILED",
				error instanceof Error ? error.message : "Failed to reveal the selected item.",
			);
		}
	}
	return { ok: true };
}
