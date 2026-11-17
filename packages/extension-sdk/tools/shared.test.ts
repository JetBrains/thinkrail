import { describe, expect, it } from "bun:test";
import * as canonical from "@thinkrail/extension-api/installed";
import { EXTENSION_KEYWORD } from "../src/builder/manifest";
import { EXTENSION_API_VERSION, HOST_OBJECT, SHARED_SPECIFIERS } from "../src/shared";

describe("the SDK's runtime copy of the installed-extension constants", () => {
	it("matches the app's canonical values", () => {
		expect(EXTENSION_API_VERSION).toBe(canonical.EXTENSION_API_VERSION);
		expect(HOST_OBJECT).toBe(canonical.EXTENSION_HOST_OBJECT);
		expect(EXTENSION_KEYWORD).toBe(canonical.EXTENSION_KEYWORD);
	});

	it("lists the same shared specifiers in the same order", () => {
		expect([...SHARED_SPECIFIERS]).toEqual([...canonical.SHARED_SPECIFIERS]);
	});
});
