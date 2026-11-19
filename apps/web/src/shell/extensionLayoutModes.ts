import { t } from "@thinkrail/locales/react";
import { useMemo } from "react";
import {
	extensionLayoutPresets,
	findExtensionLayoutPreset,
	type RegisteredLayoutPreset,
} from "../extensions";
import { toast, useAppStore } from "../store";
import { errorText, supportsExtensionQuery } from "../transport";
import { openableContributions, useExtensionCatalog } from "./extensionPanelHost";
import { currentLayoutMode, enterLayoutModeLocally, exitLayoutModeLocally } from "./layoutState";

/** Enters an extension's layout preset in this window; a failure leaves the frame as it was. */
export function enterExtensionLayoutPreset(preset: RegisteredLayoutPreset): void {
	if (!useAppStore.getState().activeWorkspaceId) return;
	try {
		enterLayoutModeLocally(preset.id, preset.declaration);
	} catch (error) {
		toast.error(errorText(error), t("workbench.layoutMode.enterFailed"));
	}
}

/** Leaves the window's layout mode, whichever extension's it is (even one switched off or gone). */
export function exitLayoutMode(): void {
	try {
		exitLayoutModeLocally();
	} catch (error) {
		toast.error(errorText(error), t("workbench.layoutMode.exitFailed"));
	}
}

/** `PanelHost.layoutPreset`: the preset name when the window's mode is one of `extension`'s. */
export function extensionLayoutMode(modeId: string | null, extension: string): string | null {
	const preset = modeId ? findExtensionLayoutPreset(modeId) : undefined;
	return preset?.extension === extension ? preset.preset : null;
}

/** A panel's `enterLayoutPreset`: its own extension's preset only. */
export function enterOwnLayoutPreset(extension: string, preset: string): void {
	const found = findExtensionLayoutPreset(`${extension}:${preset}`);
	if (found) enterExtensionLayoutPreset(found);
}

/** A panel's `exitLayoutPreset`: only while the window's mode is its extension's. */
export function exitOwnLayoutPreset(extension: string): void {
	const mode = currentLayoutMode();
	if (mode && extensionLayoutMode(mode.id, extension) !== null) exitLayoutMode();
}

export function useLayoutModeId(): string | null {
	return useAppStore((state) => state.localLayoutPreferences.layoutMode?.id ?? null);
}

/** The layout presets the palette may offer: those whose extension is on and listed by the host. */
export function useOpenableLayoutPresets(): readonly RegisteredLayoutPreset[] {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const presets = extensionLayoutPresets();
	const { read } = useExtensionCatalog(
		presets.length > 0 && supportsExtensionQuery(protocolVersion),
	);
	return useMemo(
		() => openableContributions({ disabled, protocolVersion, catalog: read, items: presets }),
		[disabled, protocolVersion, read, presets],
	);
}
