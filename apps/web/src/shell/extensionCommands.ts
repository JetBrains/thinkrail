import { isImeComposing } from "@thinkrail/ui/keyboard";
import {
	chordFromEvent,
	elementKeyUses,
	matchKeybinding,
	type ResolvedKeybindings,
	type ShortcutSurface,
} from "../keybindings";
import { isTextEntryTarget } from "../lib";
import { currentKeybindings } from "./keybindingState";

type CommandListener = (id: string) => void;

type ExtensionHotkeyEvent = Parameters<typeof matchKeybinding>[1] &
	Pick<KeyboardEvent, "isComposing" | "keyCode">;

const listeners = new Map<string, Set<CommandListener>>();
const claims = new Set<string>();

export function subscribeExtensionCommands(
	extension: string,
	listener: CommandListener,
): () => void {
	const subscribed = listeners.get(extension) ?? new Set<CommandListener>();
	listeners.set(extension, subscribed);
	subscribed.add(listener);
	return () => {
		subscribed.delete(listener);
	};
}

export function deliverExtensionCommand(extension: string, id: string): void {
	for (const listener of [...(listeners.get(extension) ?? [])]) listener(id);
}

export function claimKeyboard(extension: string, active: boolean): void {
	if (active) claims.add(extension);
	else claims.delete(extension);
}

export function keyboardClaimed(): boolean {
	return claims.size > 0;
}

function ownedBy(
	surface: ShortcutSurface | null,
	event: ExtensionHotkeyEvent,
	platform: string,
): boolean {
	if (surface === null) return false;
	const pressed = chordFromEvent(event, platform, { allowPlain: true });
	return (
		pressed.kind === "chord" &&
		elementKeyUses(pressed.chord, platform).some((entry) => entry.surface === surface)
	);
}

export function extensionHotkey(
	event: ExtensionHotkeyEvent,
	keybindings: ResolvedKeybindings,
	textEntry: boolean,
	surface: ShortcutSurface | null = null,
): { extension: string; id: string } | null {
	if (isImeComposing(event)) return null;
	const id = matchKeybinding(keybindings, event, { textEntry });
	const extension = id === null ? null : keybindings.byId.get(id)?.extension;
	if (id === null || !extension || ownedBy(surface, event, keybindings.platform)) return null;
	return { extension, id };
}

export function matchExtensionCommand(extension: string, event: KeyboardEvent): string | null {
	const target = event.composedPath()[0] ?? event.target;
	const hotkey = extensionHotkey(event, currentKeybindings(), isTextEntryTarget(target));
	return hotkey?.extension === extension ? hotkey.id : null;
}
