import type { NativeCommand, NativeQuitHint, NativeShortcutsBridge } from "@thinkrail/contracts";

export function createShortcutsBridge(quit: () => Promise<void>) {
	const quitHintListeners = new Set<(hint: NativeQuitHint) => void>();
	const commandListeners = new Set<(command: NativeCommand) => void>();
	const bridge: NativeShortcutsBridge = Object.freeze({
		subscribeQuitHint: (listener: (hint: NativeQuitHint) => void) => {
			quitHintListeners.add(listener);
			return () => quitHintListeners.delete(listener);
		},
		subscribeCommand: (listener: (command: NativeCommand) => void) => {
			commandListeners.add(listener);
			return () => commandListeners.delete(listener);
		},
		quit,
	});
	return {
		bridge,
		emitQuitHint: (hint: NativeQuitHint) => {
			for (const listener of quitHintListeners) listener(hint);
		},
		emitCommand: (command: NativeCommand) => {
			for (const listener of commandListeners) listener(command);
		},
	};
}
