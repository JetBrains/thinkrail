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
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";

export const EXTENSION_HOST_API = "1.0";

export const SHARED_SPECIFIERS = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	"@thinkrail/extension-sdk/web",
	"@thinkrail/extension-sdk/resources",
	"@thinkrail/extension-sdk/ui/button",
	"@thinkrail/extension-sdk/ui/dialog",
	"@thinkrail/extension-sdk/ui/textarea",
	"@thinkrail/extension-sdk/ui/keyboard",
	"@thinkrail/extension-sdk/ui/attention-line",
	"@thinkrail/extension-sdk/ui/utils",
	"@thinkrail/extension-sdk/ui/theme",
	"@thinkrail/extension-sdk/ui/fonts",
] as const;

export type SharedSpecifier = (typeof SHARED_SPECIFIERS)[number];

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
		"@thinkrail/extension-sdk/ui/button": uiButton,
		"@thinkrail/extension-sdk/ui/dialog": uiDialog,
		"@thinkrail/extension-sdk/ui/textarea": uiTextarea,
		"@thinkrail/extension-sdk/ui/keyboard": uiKeyboard,
		"@thinkrail/extension-sdk/ui/attention-line": uiAttentionLine,
		"@thinkrail/extension-sdk/ui/utils": uiUtils,
		"@thinkrail/extension-sdk/ui/theme": uiTheme,
		"@thinkrail/extension-sdk/ui/fonts": uiFonts,
	};
	const host: ExtensionHost = Object.freeze({
		api: EXTENSION_HOST_API,
		modules: Object.freeze(modules),
	});
	globalThis.__thinkrailExtensionHost = host;
	return host;
}
