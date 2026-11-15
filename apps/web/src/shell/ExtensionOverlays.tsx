import { browserPlatform } from "@thinkrail/ui/keyboard";
import { useState } from "react";
import { enabledWebExtensions } from "../extensions";
import { isTextEntryTarget } from "../lib";
import { useAppStore } from "../store";
import { activeLayer } from "./shortcutLayers";

export function ExtensionOverlays() {
	const disabled = useAppStore((state) => state.disabledExtensions);
	const [platform] = useState(browserPlatform);
	return enabledWebExtensions(disabled).map(({ name, globalOverlay: Overlay }) =>
		Overlay ? (
			<Overlay
				key={name}
				isTextEntry={isTextEntryTarget}
				activeLayer={activeLayer}
				platform={platform}
			/>
		) : null,
	);
}
