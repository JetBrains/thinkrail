import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import * as canonical from "@thinkrail/extension-api/installed";
import { EXTENSION_KEYWORD } from "../src/builder/manifest";
import { EXTENSION_API_VERSION, HOST_OBJECT, SHARED_SPECIFIERS } from "../src/shared";
import { versionMismatch } from "./version";

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

const { version } = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

describe("the SDK's version", () => {
	it("carries the extension API it builds as its major.minor", () => {
		const mismatch = versionMismatch(version, EXTENSION_API_VERSION);
		if (mismatch !== undefined) throw new Error(mismatch);
	});

	it("exempts only the unreleased 0.0.0", () => {
		expect(versionMismatch("0.0.0", "1.0")).toBeUndefined();
		expect(versionMismatch("1.0.7", "1.0")).toBeUndefined();
		expect(versionMismatch("1.1.0", "1.0")).toContain("its version must be 1.0.x");
		expect(versionMismatch("2.0.0", "1.0")).toContain("only the unreleased 0.0.0 is exempt");
	});

	it("is asked for as ~<api>.0 in the README", () => {
		const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
		const ranges = [...readme.matchAll(/"@thinkrail\/extension-sdk": "([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(ranges.length).toBeGreaterThan(0);
		for (const range of ranges) expect(range).toBe(`~${EXTENSION_API_VERSION}.0`);
	});
});
