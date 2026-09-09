function serializeForPreload(value: unknown): string {
	return JSON.stringify(JSON.stringify(value))
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

export function prependPreloadGlobal(
	preloadSource: string,
	globalName: string,
	value: unknown,
): string {
	return `Object.defineProperty(globalThis, ${JSON.stringify(globalName)}, { value: JSON.parse(${serializeForPreload(value)}), configurable: true });\n${preloadSource}`;
}

export function takePreloadGlobal(globalName: string): unknown {
	const globals = globalThis as typeof globalThis & Record<string, unknown>;
	const value = Reflect.get(globals, globalName);
	Reflect.deleteProperty(globals, globalName);
	return value;
}
