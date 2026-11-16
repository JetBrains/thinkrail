import type { KeybindingOverrides } from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import { browserPlatform } from "@thinkrail/ui/keyboard";
import { webExtensionCommands, webExtensions } from "../extensions";
import {
	type KeybindingEntry,
	type KeybindingList,
	keybindingKeys,
	keybindingLabel,
	keybindingList,
	type ResolvedKeybindings,
	resolveKeybindings,
} from "../keybindings";
import { useAppStore } from "../store";
import { supportsKeybindings } from "../transport";

type KeybindingSource = Pick<
	ReturnType<typeof useAppStore.getState>,
	"keybindingOverrides" | "disabledExtensions" | "protocolVersion"
>;

const NO_OVERRIDES: KeybindingOverrides = {};

let resolvedFor: {
	overrides: KeybindingOverrides;
	disabled: readonly string[];
	keybindings: ResolvedKeybindings;
} | null = null;

export function selectKeybindings(state: KeybindingSource): ResolvedKeybindings {
	const overrides = supportsKeybindings(state.protocolVersion)
		? state.keybindingOverrides
		: NO_OVERRIDES;
	const disabled = state.disabledExtensions;
	if (resolvedFor?.overrides === overrides && resolvedFor.disabled === disabled) {
		return resolvedFor.keybindings;
	}
	const keybindings = resolveKeybindings({
		platform: browserPlatform(),
		overrides,
		extensions: webExtensionCommands(disabled),
	});
	resolvedFor = { overrides, disabled, keybindings };
	return keybindings;
}

export function currentKeybindings(): ResolvedKeybindings {
	return selectKeybindings(useAppStore.getState());
}

export function useResolvedKeybindings(): ResolvedKeybindings {
	return useAppStore(selectKeybindings);
}

export function useKeybindingKeys(id: string, options: { browser?: boolean } = {}): string[] {
	return keybindingKeys(useResolvedKeybindings(), id, options);
}

export function useKeybindingLabel(id: string, options: { browser?: boolean } = {}): string {
	return keybindingLabel(useResolvedKeybindings(), id, options);
}

export function useKeybindingList(desktop: boolean): KeybindingList {
	const keybindings = useResolvedKeybindings();
	const disabled = useAppStore((state) => state.disabledExtensions);
	return keybindingList({
		desktop,
		keybindings,
		extensions: webExtensions.map(({ name, shortcuts = [] }) => ({
			extension: name,
			enabled: !disabled.includes(name),
			shortcuts,
		})),
	});
}

export function entryTitle(
	t: Translator,
	entry: Pick<KeybindingEntry, "title" | "position">,
): string {
	return entry.position === null ? t(entry.title) : t(entry.title, { position: entry.position });
}

export function commandTitle(t: Translator, list: KeybindingList, command: string): string {
	const entry = list.entries.find((candidate) => candidate.command === command);
	return entry ? entryTitle(t, entry) : command;
}
