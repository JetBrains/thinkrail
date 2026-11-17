import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { normalizeManifestPath } from "@thinkrail/extension-api/installed";
import { ExtensionBuildError } from "../src/builder/errors";
import { readExtensionPackage } from "../src/builder/manifest";
import { type Fixture, fixture } from "../src/builder/testing";
import { EXTENSION_API_VERSION } from "../src/shared";

interface ManifestCase {
	label: string;
	packageJson: unknown;
	valid: boolean;
}

const CASES = JSON.parse(
	readFileSync(new URL("../../extension-api/src/manifestCases.json", import.meta.url), "utf8"),
) as ManifestCase[];

const fields = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

function accepted({ packageJson }: ManifestCase): boolean {
	const server = fields(fields(packageJson).thinkrail).server;
	const files: Record<string, string> = {};
	if (typeof server === "string") {
		const path = normalizeManifestPath(server);
		if (path !== undefined) files[path] = "export default {};\n";
	}
	current = fixture({}, files);
	current.write("package.json", JSON.stringify(packageJson));
	try {
		readExtensionPackage(current.root);
		return true;
	} catch (error) {
		expect(error).toBeInstanceOf(ExtensionBuildError);
		return false;
	}
}

let current: Fixture | undefined;
afterEach(() => {
	current?.dispose();
	current = undefined;
});

describe("the build agrees with the host on the shared manifest cases", () => {
	it.each(CASES.map((entry) => [entry.label, entry] as const))("%s", (_label, entry) => {
		const api = fields(fields(entry.packageJson).thinkrail).api;
		expect(accepted(entry)).toBe(entry.valid && api === EXTENSION_API_VERSION);
	});

	it("includes manifests the host loads but this SDK does not build", () => {
		const otherApi = CASES.filter(
			(entry) =>
				entry.valid && fields(fields(entry.packageJson).thinkrail).api !== EXTENSION_API_VERSION,
		);
		expect(otherApi.length).toBeGreaterThan(0);
	});
});
