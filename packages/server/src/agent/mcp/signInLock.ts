import { mcpNamespace } from "./config";

type McpSignInHolder = "settings" | "chat";

const locks = new Map<string, { holder: McpSignInHolder }>();

export function acquireMcpSignInLock(
	serverName: string,
	holder: McpSignInHolder,
): { release: () => void } | { heldBy: McpSignInHolder } {
	const key = mcpNamespace(serverName);
	const current = locks.get(key);
	if (current) return { heldBy: current.holder };
	const lock = { holder };
	locks.set(key, lock);
	return {
		release: () => {
			if (locks.get(key) === lock) locks.delete(key);
		},
	};
}
