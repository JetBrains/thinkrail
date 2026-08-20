const chains = new Map<string, Promise<void>>();

export function withReviewLock<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
	const previous = chains.get(workspaceId) ?? Promise.resolve();
	const result = previous.then(operation);
	const settled = result.then(
		() => {},
		() => {},
	);
	chains.set(workspaceId, settled);
	void settled.then(() => {
		if (chains.get(workspaceId) === settled) chains.delete(workspaceId);
	});
	return result;
}
