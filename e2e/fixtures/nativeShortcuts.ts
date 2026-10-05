import type { Page } from "@playwright/test";
import type { NativeCommand, NativeQuitHint, NativeShortcutsBridge } from "@thinkrail/contracts";

interface ShortcutsStub {
	hint(hint: NativeQuitHint): void;
	command(command: NativeCommand): void;
	quits: number;
	rejectQuit: boolean;
}

declare global {
	interface Window {
		__e2eShortcuts: ShortcutsStub;
	}
}

export async function installNativeShortcuts(page: Page, platform: string) {
	await setNavigatorPlatform(page, platform);
	await page.addInitScript(() => {
		const hintListeners = new Set<(hint: NativeQuitHint) => void>();
		const commandListeners = new Set<(command: NativeCommand) => void>();
		const stub: ShortcutsStub = {
			hint: (hint) => {
				for (const listener of hintListeners) listener(hint);
			},
			command: (command) => {
				for (const listener of commandListeners) listener(command);
			},
			quits: 0,
			rejectQuit: false,
		};
		window.__e2eShortcuts = stub;
		const bridge: NativeShortcutsBridge = Object.freeze({
			subscribeQuitHint: (listener: (hint: NativeQuitHint) => void) => {
				hintListeners.add(listener);
				return () => hintListeners.delete(listener);
			},
			subscribeCommand: (listener: (command: NativeCommand) => void) => {
				commandListeners.add(listener);
				return () => commandListeners.delete(listener);
			},
			quit: async () => {
				stub.quits += 1;
				if (stub.rejectQuit) throw new Error("quit refused");
			},
		});
		Reflect.set(window, "__THINKRAIL_NATIVE_SHORTCUTS__", bridge);
	});
}

export function setNavigatorPlatform(page: Page, platform: string) {
	return page.addInitScript((navigatorPlatform) => {
		Object.defineProperty(Navigator.prototype, "platform", { get: () => navigatorPlatform });
	}, platform);
}
