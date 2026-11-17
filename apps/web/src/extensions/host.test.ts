import { expect, test } from "bun:test";
import * as extensionApiWeb from "@thinkrail/extension-api/web";
import * as resourceRenderers from "@thinkrail/resource-renderers";
import * as uiButton from "@thinkrail/ui/button";
import * as React from "react";
import { EXTENSION_HOST_API, installExtensionHost, SHARED_SPECIFIERS } from "./index";

test("the host object exposes exactly extension API v1's shared modules, frozen", () => {
	const host = installExtensionHost();
	expect(globalThis.__thinkrailExtensionHost).toBe(host);
	expect(host.api).toBe(EXTENSION_HOST_API);
	expect(EXTENSION_HOST_API).toBe("1.0");
	expect(SHARED_SPECIFIERS).toEqual([
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
	]);
	expect(Object.keys(host.modules)).toEqual([...SHARED_SPECIFIERS]);
	expect(Object.isFrozen(host)).toBe(true);
	expect(Object.isFrozen(host.modules)).toBe(true);
	expect(host.modules.react).toBe(React);
	expect(host.modules["@thinkrail/extension-sdk/web"]).toBe(extensionApiWeb);
	expect(host.modules["@thinkrail/extension-sdk/resources"]).toBe(resourceRenderers);
	expect(host.modules["@thinkrail/extension-sdk/ui/button"]).toBe(uiButton);
	const resources = host.modules["@thinkrail/extension-sdk/resources"];
	expect(typeof Reflect.get(resources, "ResourcePreview")).toBe("function");
	expect(typeof Reflect.get(resources, "useResourceScope")).toBe("function");
});
