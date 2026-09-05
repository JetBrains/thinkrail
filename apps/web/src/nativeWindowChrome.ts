export const NATIVE_WINDOW_CHROME_GLOBAL = "__THINKRAIL_NATIVE_WINDOW_CHROME__";

export type NativeResizeEdge =
	| "north-west"
	| "north"
	| "north-east"
	| "west"
	| "east"
	| "south-west"
	| "south"
	| "south-east";

export interface NativeWindowChromeAdapter {
	readonly version: 1;
	readonly platform: "macos" | "windows" | "linux";
	getSnapshot(): { maximized: boolean };
	subscribe(listener: () => void): () => void;
	minimize(): void;
	toggleMaximize(): void;
	requestClose(): void;
	startResize(edge: NativeResizeEdge): void;
}

const METHODS = [
	"getSnapshot",
	"subscribe",
	"minimize",
	"toggleMaximize",
	"requestClose",
	"startResize",
] as const;

export function asNativeWindowChromeAdapter(value: unknown): NativeWindowChromeAdapter | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	if (Reflect.get(value, "version") !== 1) return null;
	const platform = Reflect.get(value, "platform");
	if (platform !== "macos" && platform !== "windows" && platform !== "linux") return null;
	for (const method of METHODS) {
		if (typeof Reflect.get(value, method) !== "function") return null;
	}
	return value as NativeWindowChromeAdapter;
}

export function getNativeWindowChromeAdapter(): NativeWindowChromeAdapter | null {
	return asNativeWindowChromeAdapter(Reflect.get(globalThis, NATIVE_WINDOW_CHROME_GLOBAL));
}
