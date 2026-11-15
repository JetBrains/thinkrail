import { isImeComposing } from "@thinkrail/ui/keyboard";
import { matchKeybinding, type ResolvedKeybindings } from "../keybindings";
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

export function extensionHotkey(
	event: ExtensionHotkeyEvent,
	keybindings: ResolvedKeybindings,
	textEntry: boolean,
): { extension: string; id: string } | null {
	if (isImeComposing(event)) return null;
	const id = matchKeybinding(keybindings, event, { textEntry });
	const extension = id === null ? null : keybindings.byId.get(id)?.extension;
	return id !== null && extension ? { extension, id } : null;
}

export function matchExtensionCommand(extension: string, event: KeyboardEvent): string | null {
	const target = event.composedPath()[0] ?? event.target;
	const hotkey = extensionHotkey(event, currentKeybindings(), isTextEntryTarget(target));
	return hotkey?.extension === extension ? hotkey.id : null;
}
