import { expect, test } from "bun:test";
import {
	EXTENSION_API_VERSION,
	EXTENSION_HOST_OBJECT,
	SHARED_MODULE_EXPORTS,
	SHARED_SPECIFIERS,
} from "@thinkrail/extension-api/installed";
import * as extensionApiWeb from "@thinkrail/extension-api/web";
import * as resourceRenderers from "@thinkrail/resource-renderers";
import * as uiButton from "@thinkrail/ui/button";
import * as React from "react";
import { installExtensionHost } from "./index";

test("the host object exposes exactly extension API v1's shared modules, frozen", () => {
	const host = installExtensionHost();
	expect(globalThis.__thinkrailExtensionHost).toBe(host);
	expect(Reflect.get(globalThis, EXTENSION_HOST_OBJECT)).toBe(host);
	expect(host.api).toBe(EXTENSION_API_VERSION);
	expect(Object.keys(host.modules)).toEqual([...SHARED_SPECIFIERS]);
	expect(Object.isFrozen(host)).toBe(true);
	expect(Object.isFrozen(host.modules)).toBe(true);
});

test("each shared module holds only its allow-listed names, each the app's own value", () => {
	const host = installExtensionHost();
	for (const specifier of SHARED_SPECIFIERS) {
		const shared = host.modules[specifier];
		expect(Object.isFrozen(shared)).toBe(true);
		expect(Object.keys(shared).sort()).toEqual([...SHARED_MODULE_EXPORTS[specifier]].sort());
		for (const name of SHARED_MODULE_EXPORTS[specifier])
			expect(Reflect.get(shared, name)).toBeDefined();
	}
	expect(Reflect.get(host.modules.react, "useState")).toBe(React.useState);
	expect(Reflect.get(host.modules["@thinkrail/extension-sdk/web"], "strArg")).toBe(
		extensionApiWeb.strArg,
	);
	expect(Reflect.get(host.modules["@thinkrail/extension-sdk/resources"], "ResourcePreview")).toBe(
		resourceRenderers.ResourcePreview,
	);
	expect(Reflect.get(host.modules["@thinkrail/extension-sdk/ui/button"], "Button")).toBe(
		uiButton.Button,
	);
});

test("nothing outside the allow-list is reachable", () => {
	const host = installExtensionHost();
	for (const [specifier, name] of [
		["react", "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE"],
		["react", "unstable_useCacheRefresh"],
		["react", "default"],
		["react-dom", "useFormState"],
		["react-dom", "unstable_batchedUpdates"],
		["@thinkrail/extension-sdk/web", "languageFromPath"],
		["@thinkrail/extension-sdk/web", "parseToolResultContent"],
		["@thinkrail/extension-sdk/resources", "HtmlViewportSwitch"],
		["@thinkrail/extension-sdk/ui/button", "buttonVariants"],
	] as const) {
		expect(Reflect.get(host.modules[specifier], name)).toBeUndefined();
	}
	expect(Reflect.get(host.modules, "@thinkrail/extension-sdk/ui/dialog")).toBeUndefined();
});
