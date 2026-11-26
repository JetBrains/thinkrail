import {
	EXTENSION_API_VERSION,
	EXTENSION_HOST_OBJECT,
	SHARED_MODULE_EXPORTS,
	type SharedSpecifier,
} from "@thinkrail/extension-api/installed";
import * as extensionApiWeb from "@thinkrail/extension-api/web";
import * as resourceRenderers from "@thinkrail/resource-renderers";
import * as uiButton from "@thinkrail/ui/button";
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

function allowed<M extends object, K extends keyof M & string>(
	module: M,
	names: readonly K[],
): Readonly<Partial<Pick<M, K>>> {
	const picked: Partial<Pick<M, K>> = {};
	for (const name of names) picked[name] = module[name];
	return Object.freeze(picked);
}

export function installExtensionHost(): ExtensionHost {
	const exports = SHARED_MODULE_EXPORTS;
	const modules: Record<SharedSpecifier, object> = {
		react: allowed(React, exports.react),
		"react/jsx-runtime": allowed(jsxRuntime, exports["react/jsx-runtime"]),
		"react-dom": allowed(ReactDOM, exports["react-dom"]),
		"@thinkrail/extension-sdk/web": allowed(
			extensionApiWeb,
			exports["@thinkrail/extension-sdk/web"],
		),
		"@thinkrail/extension-sdk/resources": allowed(
			resourceRenderers,
			exports["@thinkrail/extension-sdk/resources"],
		),
		"@thinkrail/extension-sdk/ui/button": allowed(
			uiButton,
			exports["@thinkrail/extension-sdk/ui/button"],
		),
		"@thinkrail/extension-sdk/ui/theme": allowed(
			uiTheme,
			exports["@thinkrail/extension-sdk/ui/theme"],
		),
		"@thinkrail/extension-sdk/ui/utils": allowed(
			uiUtils,
			exports["@thinkrail/extension-sdk/ui/utils"],
		),
	};
	const host: ExtensionHost = Object.freeze({
		api: EXTENSION_API_VERSION,
		modules: Object.freeze(modules),
	});
	globalThis[EXTENSION_HOST_OBJECT] = host;
	return host;
}
