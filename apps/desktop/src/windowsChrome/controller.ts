import { cc, type Pointer, ptr } from "bun:ffi";
import { readWindowChromeGeometry, type WindowChromeGeometry } from "../windowChrome";

export type WindowsChromeAppearance = Readonly<{
	backgroundColor: number | null;
	dark: boolean;
}>;

export type WindowsChromeController = Readonly<{
	readGeometry(): WindowChromeGeometry | null;
	setAppearance(appearance: WindowsChromeAppearance): void;
}>;

export const windowsChromeSymbols = {
	windows_chrome_install: { args: ["ptr"], returns: "u32" },
	windows_chrome_read: { args: ["ptr", "u32", "ptr"], returns: "i32" },
	windows_chrome_appearance: { args: ["ptr", "u32", "i32", "i32"], returns: "i32" },
} as const;

function compileNative(sourcePath: string) {
	return cc({
		source: Bun.file(sourcePath),
		library: ["user32", "gdi32", "dwmapi"],
		symbols: windowsChromeSymbols,
	});
}

let native: ReturnType<typeof compileNative> | undefined;

export function isWindowsChromeAppearance(value: unknown): value is WindowsChromeAppearance {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const backgroundColor: unknown = Reflect.get(value, "backgroundColor");
	return (
		typeof Reflect.get(value, "dark") === "boolean" &&
		(backgroundColor === null ||
			(typeof backgroundColor === "number" &&
				Number.isInteger(backgroundColor) &&
				backgroundColor >= 0 &&
				backgroundColor <= 0xffffff))
	);
}

export function ffiBackgroundColor(value: number | null): number {
	return (value ?? -1) | 0;
}

export function createWindowsChrome(window: Pointer, sourcePath: string): WindowsChromeController {
	if (process.platform !== "win32" || process.arch !== "x64") {
		throw new Error("Windows chrome requires win32-x64");
	}
	if (!Number.isSafeInteger(window) || window <= 0) {
		throw new TypeError("Windows chrome requires a non-null window pointer");
	}
	native ??= compileNative(sourcePath);
	const library = native;
	const generation = library.symbols.windows_chrome_install(window);
	if (generation === 0) throw new Error("Windows chrome could not own the window");
	return {
		readGeometry() {
			const output = new Float64Array(2);
			if (!library.symbols.windows_chrome_read(window, generation, ptr(output))) return null;
			return readWindowChromeGeometry({ insetLeft: output[0], insetRight: output[1] });
		},
		setAppearance(appearance) {
			if (!isWindowsChromeAppearance(appearance)) {
				throw new TypeError("Windows chrome requires an RGB background or null and a dark boolean");
			}
			if (
				!library.symbols.windows_chrome_appearance(
					window,
					generation,
					ffiBackgroundColor(appearance.backgroundColor),
					Number(appearance.dark),
				)
			) {
				throw new Error("Windows chrome appearance synchronization failed");
			}
		},
	};
}
