type McpSignInHolder = "settings" | "chat";

const locks = new Map<string, { holder: McpSignInHolder }>();

export function acquireMcpSignInLock(
	serverName: string,
	holder: McpSignInHolder,
): { release: () => void } | { heldBy: McpSignInHolder } {
	const current = locks.get(serverName);
	if (current) return { heldBy: current.holder };
	const lock = { holder };
	locks.set(serverName, lock);
	return {
		release: () => {
			if (locks.get(serverName) === lock) locks.delete(serverName);
		},
	};
}
