import {
	EXTENSION_API_VERSION,
	EXTENSION_HOST_OBJECT,
	type SharedSpecifier,
} from "@thinkrail/extension-api/installed";
import * as extensionApiWeb from "@thinkrail/extension-api/web";
import * as resourceRenderers from "@thinkrail/resource-renderers";
import * as uiAttentionLine from "@thinkrail/ui/attention-line";
import * as uiButton from "@thinkrail/ui/button";
import * as uiDialog from "@thinkrail/ui/dialog";
import * as uiFonts from "@thinkrail/ui/fonts";
import * as uiKeyboard from "@thinkrail/ui/keyboard";
import * as uiTextarea from "@thinkrail/ui/textarea";
import * as uiTheme from "@thinkrail/ui/theme";
import * as uiUtils from "@thinkrail/ui/utils";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";

export interface ExtensionHost {
	readonly api: string;
	readonly modules: Readonly<Record<SharedSpecifier, object>>;
}

declare global {
	var __thinkrailExtensionHost: ExtensionHost | undefined;
}

export function installExtensionHost(): ExtensionHost {
	const modules: Record<SharedSpecifier, object> = {
		react: React,
		"react/jsx-runtime": jsxRuntime,
		"react-dom": ReactDOM,
		"@thinkrail/extension-sdk/web": extensionApiWeb,
		"@thinkrail/extension-sdk/resources": resourceRenderers,
		"@thinkrail/extension-sdk/ui/attention-line": uiAttentionLine,
		"@thinkrail/extension-sdk/ui/button": uiButton,
		"@thinkrail/extension-sdk/ui/dialog": uiDialog,
		"@thinkrail/extension-sdk/ui/fonts": uiFonts,
		"@thinkrail/extension-sdk/ui/keyboard": uiKeyboard,
		"@thinkrail/extension-sdk/ui/textarea": uiTextarea,
		"@thinkrail/extension-sdk/ui/theme": uiTheme,
		"@thinkrail/extension-sdk/ui/utils": uiUtils,
	};
	const host: ExtensionHost = Object.freeze({
		api: EXTENSION_API_VERSION,
		modules: Object.freeze(modules),
	});
	globalThis[EXTENSION_HOST_OBJECT] = host;
	return host;
}
