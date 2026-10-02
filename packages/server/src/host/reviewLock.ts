export function createKeyedLock(): <T>(key: string, operation: () => Promise<T>) => Promise<T> {
	const chains = new Map<string, Promise<void>>();
	return <T>(key: string, operation: () => Promise<T>): Promise<T> => {
		const previous = chains.get(key) ?? Promise.resolve();
		const result = previous.then(operation);
		const settled = result.then(
			() => {},
			() => {},
		);
		chains.set(key, settled);
		void settled.then(() => {
			if (chains.get(key) === settled) chains.delete(key);
		});
		return result;
	};
}

export const withReviewLock = createKeyedLock();

export const withChangeLock = createKeyedLock();
