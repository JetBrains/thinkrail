import type { NativeCommand, NativeQuitHint, NativeShortcutsBridge } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { requestClose } from "./closeRequestChannel";
import { createWebShortcuts, shortcutPlatform } from "./shortcutCommands";
import { hasDismissibleLayer, isInTerminal } from "./shortcutLayers";

const NATIVE_SHORTCUTS_GLOBAL = "__THINKRAIL_NATIVE_SHORTCUTS__";

export function getNativeShortcutsBridge(value: unknown): NativeShortcutsBridge | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	try {
		return typeof Reflect.get(value, "subscribeQuitHint") === "function" &&
			typeof Reflect.get(value, "subscribeCommand") === "function" &&
			typeof Reflect.get(value, "quit") === "function"
			? (value as NativeShortcutsBridge)
			: null;
	} catch {
		return null;
	}
}

function dismissTopLayer() {
	const doc = globalThis.document;
	if (!hasDismissibleLayer(doc)) return false;
	(doc.activeElement ?? doc.body ?? doc).dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Escape",
			code: "Escape",
			bubbles: true,
			cancelable: true,
		}),
	);
	return true;
}

function subscribeToNativeShortcuts(
	bridge: NativeShortcutsBridge,
	onQuitHint: (hint: NativeQuitHint) => void,
	onCommand: (command: NativeCommand) => void,
) {
	let active = true;
	const unsubscribeQuitHint = bridge.subscribeQuitHint((hint) => {
		if (active) onQuitHint(hint);
	});
	const unsubscribeCommand = bridge.subscribeCommand((command) => {
		if (active) onCommand(command);
	});
	return () => {
		active = false;
		unsubscribeQuitHint();
		unsubscribeCommand();
	};
}

function intervalScope() {
	const stops = new Set<() => void>();
	function every(callback: () => void, ms: number) {
		const timer = setInterval(callback, ms);
		function stop() {
			clearInterval(timer);
			stops.delete(stop);
		}
		stops.add(stop);
		return stop;
	}
	function dispose() {
		for (const stop of stops) stop();
	}
	return { every, dispose };
}

export function useAppShortcuts() {
	const [bridge] = useState(() =>
		getNativeShortcutsBridge(Reflect.get(globalThis, NATIVE_SHORTCUTS_GLOBAL)),
	);
	const [quitHint, setQuitHint] = useState<NativeQuitHint>("hidden");

	useEffect(() => {
		if (!bridge) return undefined;
		const intervals = intervalScope();
		const shortcuts = createWebShortcuts({
			platform: shortcutPlatform(true),
			closeItem: () => {
				if (!dismissTopLayer()) requestClose();
			},
			quit: () => {
				bridge.quit().catch((error: unknown) => {
					console.error("[shortcuts] quit failed", error);
					shortcuts.resetQuit();
				});
			},
			onQuitHint: setQuitHint,
			isInTerminal,
			now: () => performance.now(),
			every: intervals.every,
		});
		const unsubscribe = subscribeToNativeShortcuts(bridge, setQuitHint, shortcuts.run);
		const doc = globalThis.document;
		function onVisibilityChange() {
			if (doc.visibilityState === "hidden") shortcuts.cancel();
		}
		window.addEventListener("keydown", shortcuts.keydown, true);
		window.addEventListener("keyup", shortcuts.keyup, true);
		window.addEventListener("blur", shortcuts.cancel);
		doc.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			unsubscribe();
			window.removeEventListener("keydown", shortcuts.keydown, true);
			window.removeEventListener("keyup", shortcuts.keyup, true);
			window.removeEventListener("blur", shortcuts.cancel);
			doc.removeEventListener("visibilitychange", onVisibilityChange);
			intervals.dispose();
		};
	}, [bridge]);

	return { quitHint: bridge ? quitHint : null };
}
