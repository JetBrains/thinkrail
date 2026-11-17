import { expect, test } from "bun:test";
import {
	EXTENSION_API_VERSION,
	EXTENSION_HOST_OBJECT,
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
	expect(host.modules.react).toBe(React);
	expect(host.modules["@thinkrail/extension-sdk/web"]).toBe(extensionApiWeb);
	expect(host.modules["@thinkrail/extension-sdk/resources"]).toBe(resourceRenderers);
	expect(host.modules["@thinkrail/extension-sdk/ui/button"]).toBe(uiButton);
	const resources = host.modules["@thinkrail/extension-sdk/resources"];
	expect(typeof Reflect.get(resources, "ResourcePreview")).toBe("function");
	expect(typeof Reflect.get(resources, "useResourceScope")).toBe("function");
});
