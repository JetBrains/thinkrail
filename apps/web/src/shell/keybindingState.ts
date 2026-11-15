import type { KeybindingOverrides } from "@thinkrail/contracts";
import { browserPlatform } from "@thinkrail/ui/keyboard";
import { webExtensionCommands } from "../extensions";
import {
	keybindingKeys,
	keybindingLabel,
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
