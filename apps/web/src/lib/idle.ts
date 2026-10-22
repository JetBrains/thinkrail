export function whenIdle(
	task: () => void,
	{ timeout, fallbackDelay }: { timeout: number; fallbackDelay: number },
): () => void {
	if (typeof globalThis.requestIdleCallback === "function") {
		const handle = globalThis.requestIdleCallback(task, { timeout });
		return () => globalThis.cancelIdleCallback(handle);
	}
	const handle = setTimeout(task, fallbackDelay);
	return () => clearTimeout(handle);
}
