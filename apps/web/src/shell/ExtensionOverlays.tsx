import type { GlobalOverlayProps } from "@thinkrail/extension-api/web";
import { browserPlatform } from "@thinkrail/ui/keyboard";
import { type ComponentType, useEffect, useState } from "react";
import { enabledWebExtensions } from "../extensions";
import { isTextEntryTarget } from "../lib";
import { useAppStore } from "../store";
import {
	claimKeyboard,
	matchExtensionCommand,
	subscribeExtensionCommands,
} from "./extensionCommands";
import { activeLayer } from "./shortcutLayers";

function ExtensionOverlay({
	name,
	Overlay,
	platform,
}: {
	name: string;
	Overlay: ComponentType<GlobalOverlayProps>;
	platform: string;
}) {
	useEffect(() => () => claimKeyboard(name, false), [name]);
	return (
		<Overlay
			isTextEntry={isTextEntryTarget}
			activeLayer={activeLayer}
			platform={platform}
			onCommand={(listener) => subscribeExtensionCommands(name, listener)}
			matchCommand={(event) => matchExtensionCommand(name, event)}
			claimKeyboard={(active) => claimKeyboard(name, active)}
		/>
	);
}

export function ExtensionOverlays() {
	const disabled = useAppStore((state) => state.disabledExtensions);
	const [platform] = useState(browserPlatform);
	return enabledWebExtensions(disabled).map(({ name, globalOverlay }) =>
		globalOverlay ? (
			<ExtensionOverlay key={name} name={name} Overlay={globalOverlay} platform={platform} />
		) : null,
	);
}
