import type { NativeWindowAppearance, NativeWindowChromeBridge } from "@thinkrail/contracts";
import { useEffect, useRef } from "react";
import { onSystemAppearanceChange, onThemeSwap, readSystemAppearance } from "../themes";

const NATIVE_WINDOW_CHROME_GLOBAL = "__THINKRAIL_NATIVE_WINDOW_CHROME__";

export function getNativeWindowChromeBridge(value: unknown): NativeWindowChromeBridge | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return typeof Reflect.get(value, "setAppearance") === "function"
		? (value as NativeWindowChromeBridge)
		: null;
}

export function reportNativeWindowAppearance(
	bridge: NativeWindowChromeBridge,
	style: Pick<CSSStyleDeclaration, "backgroundColor" | "colorScheme">,
	systemAppearance: NativeWindowAppearance["colorScheme"],
): void {
	const schemes = style.colorScheme.split(/\s+/);
	const light = schemes.includes("light");
	const dark = schemes.includes("dark");
	if (!style.backgroundColor || (!light && !dark)) return;
	try {
		bridge.setAppearance({
			backgroundColor: style.backgroundColor,
			colorScheme: dark && (!light || systemAppearance === "dark") ? "dark" : "light",
		});
	} catch (error) {
		console.warn("Could not update native window appearance", error);
	}
}

export function useNativeWindowChrome() {
	const header = useRef<HTMLElement>(null);
	useEffect(() => {
		const bridge = getNativeWindowChromeBridge(
			Reflect.get(globalThis, NATIVE_WINDOW_CHROME_GLOBAL),
		);
		const element = header.current;
		if (!bridge || !element) return;
		const report = () =>
			reportNativeWindowAppearance(bridge, getComputedStyle(element), readSystemAppearance());
		const unwatchTheme = onThemeSwap(report);
		const unwatchSystem = onSystemAppearanceChange(report);
		const forcedColors = window.matchMedia("(forced-colors: active)");
		forcedColors.addEventListener("change", report);
		report();
		return () => {
			unwatchTheme();
			unwatchSystem();
			forcedColors.removeEventListener("change", report);
		};
	}, []);
	return header;
}
