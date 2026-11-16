import type { KeybindingOverrides } from "@thinkrail/contracts";
import type { Translator } from "@thinkrail/locales/react";
import { browserPlatform } from "@thinkrail/ui/keyboard";
import type { LocalKeymap } from "@thinkrail/ui/local-keys";
import { webExtensionCommands, webExtensions } from "../extensions";
import {
	APP_LOCAL_SET,
	isAppLocalScope,
	type KeybindingEntry,
	type KeybindingList,
	keybindingKeys,
	keybindingLabel,
	keybindingList,
	LOCAL_SCOPES,
	type LocalCommandSet,
	type ResolvedKeybindings,
	resolveKeybindings,
	SHORTCUT_CATALOG,
} from "../keybindings";
import { isTextEntryTarget } from "../lib";
import { useAppStore } from "../store";
import { supportsKeybindings } from "../transport";

type KeybindingSource = Pick<
	ReturnType<typeof useAppStore.getState>,
	"keybindingOverrides" | "disabledExtensions" | "protocolVersion"
>;

const NO_OVERRIDES: KeybindingOverrides = {};

const LOCAL_SETS: readonly LocalCommandSet[] = [APP_LOCAL_SET];

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
		local: LOCAL_SETS,
	});
	resolvedFor = { overrides, disabled, keybindings };
	return keybindings;
}

let keymapFor: { keybindings: ResolvedKeybindings; keymap: LocalKeymap } | null = null;

export function selectLocalKeymap(state: KeybindingSource): LocalKeymap {
	const keybindings = selectKeybindings(state);
	if (keymapFor?.keybindings === keybindings) return keymapFor.keymap;
	const keymap: LocalKeymap = {
		platform: keybindings.platform,
		scopes: keybindings.local,
		isTextEntry: isTextEntryTarget,
	};
	keymapFor = { keybindings, keymap };
	return keymap;
}

export function useLocalKeymap(): LocalKeymap {
	return useAppStore(selectLocalKeymap);
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
	const entry =
		list.entries.find((candidate) => candidate.id === command) ??
		list.entries.find((candidate) => candidate.command === command);
	if (entry) return entryTitle(t, entry);
	const row = SHORTCUT_CATALOG.find((candidate) => candidate.id === command);
	return row ? t(row.title) : command;
}

export function scopeText(t: Translator, scope: string, kind: "where" | "inside"): string {
	if (isAppLocalScope(scope)) return t(LOCAL_SCOPES[scope][kind]);
	const extension = webExtensions.find(({ name }) => scope.startsWith(`${name}.`));
	const name = extension?.title ? t(extension.title) : (extension?.name ?? scope);
	return t(
		kind === "where"
			? "settings.keyboard.editor.extensionWhere"
			: "settings.keyboard.editor.extensionInside",
		{ name },
	);
}
