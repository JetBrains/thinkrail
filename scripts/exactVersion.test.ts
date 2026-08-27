import { expect, test } from "bun:test";
import { isExactVersion } from "./exactVersion";

test("exact versions include complete SemVer prerelease and build identifiers", () => {
	for (const version of [
		"19.2.8",
		"19.3.0-canary-a1124489-20260826",
		"1.0.0-alpha.1-feature-7+build.42-linux",
	]) {
		expect(isExactVersion(version)).toBe(true);
	}
});

test("ranges and malformed versions are not exact pins", () => {
	for (const version of ["^19.2.8", "~1.0.0", "19.3.x", "1.0.0-", "1.0", "latest"])
		expect(isExactVersion(version)).toBe(false);
});
