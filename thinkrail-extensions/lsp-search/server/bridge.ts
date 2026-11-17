import {
	LSP_BRIDGE_TOKEN_ENV,
	LSP_BRIDGE_URL_ENV,
	type LspBridgeOperation,
	type LspBridgeReply,
} from "./wire";

/** Calls one operation of the desktop shell's LSP manager for a worktree. */
export type LspBridge = <T>(
	operation: LspBridgeOperation,
	worktreePath: string,
	params: Record<string, unknown>,
	signal?: AbortSignal,
) => Promise<T>;

export const BRIDGE_UNAVAILABLE =
	"Language-server search is not available in this host (it needs the ThinkRail desktop app). " +
	"Use grep/find and read the file instead.";

/** The bridge the shell advertises through the environment, or `null` outside the shell. */
export function createBridge(
	env: Readonly<Record<string, string | undefined>> = process.env,
): LspBridge | null {
	const url = env[LSP_BRIDGE_URL_ENV];
	const token = env[LSP_BRIDGE_TOKEN_ENV];
	if (!url || !token) return null;
	return async <T>(
		operation: LspBridgeOperation,
		worktreePath: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<T> => {
		const response = await fetch(`${url}/lsp/${operation}`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({ ...params, worktreePath }),
			...(signal ? { signal } : {}),
		});
		const reply = (await response.json()) as LspBridgeReply<T>;
		if (!reply.ok) throw new Error(reply.error);
		return reply.result;
	};
}
