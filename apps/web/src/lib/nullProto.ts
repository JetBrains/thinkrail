export function nullProto<T extends object>(
	...sources: Record<never, never> extends T
		? (T | undefined)[]
		: [T, ...(Partial<T> | undefined)[]]
): T {
	return Object.assign(Object.create(null), ...sources);
}
