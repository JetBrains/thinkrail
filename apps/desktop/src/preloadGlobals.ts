export function prependPreloadGlobal(
	preloadSource: string,
	globalName: string,
	value: unknown,
): string {
	const serialized = JSON.stringify(JSON.stringify(value))
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
	return `Object.defineProperty(globalThis, ${JSON.stringify(globalName)}, { value: JSON.parse(${serialized}), configurable: true });\n${preloadSource}`;
}

export function takePreloadGlobal(globalName: string): unknown {
	const value: unknown = Reflect.get(globalThis, globalName);
	Reflect.deleteProperty(globalThis, globalName);
	return value;
}
