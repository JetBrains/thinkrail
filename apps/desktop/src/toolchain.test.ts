import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import manifest from "../package.json";
import { validateElectrobunProjection } from "./toolchain";

const roots: string[] = [];
const version = manifest.devDependencies.electrobun;

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-electrobun-toolchain-"));
	roots.push(root);
	const devkit = join(root, ".hutch", "devkit");
	mkdirSync(devkit, { recursive: true });
	writeFileSync(join(devkit, "projection.json"), JSON.stringify({ product: { version } }));
	writeFileSync(join(devkit, "package.json"), JSON.stringify({ version }));
	return devkit;
}

test("accepts metadata matching the desktop pin without requiring SDK source files", () => {
	expect(() => validateElectrobunProjection(fixture())).not.toThrow();
});

test.each([
	["missing product", {}],
	["null projection", null],
	["array projection", []],
	["null product", { product: null }],
	["array product", { product: [] }],
	["missing version", { product: {} }],
	["non-string version", { product: { version: 2.01 } }],
	["wrong version", { product: { version: "2.0.0" } }],
	["version range", { product: { version: `^${version}` } }],
])("rejects invalid projection metadata: %s", (_label, projection) => {
	const devkit = fixture();
	writeFileSync(join(devkit, "projection.json"), JSON.stringify(projection));
	expect(() => validateElectrobunProjection(devkit)).toThrow(
		`Expected Electrobun SDK version ${version} in ${join(devkit, "projection.json")}`,
	);
});

test.each([
	["missing version", {}],
	["null package", null],
	["array package", []],
	["non-string version", { version: 2.01 }],
	["wrong version", { version: "2.0.0" }],
	["version range", { version: `^${version}` }],
])("rejects invalid package metadata: %s", (_label, sdkPackage) => {
	const devkit = fixture();
	writeFileSync(join(devkit, "package.json"), JSON.stringify(sdkPackage));
	expect(() => validateElectrobunProjection(devkit)).toThrow(
		`Expected Electrobun SDK version ${version} in ${join(devkit, "package.json")}`,
	);
});

test("rejects an internally consistent projection from the wrong release", () => {
	const devkit = fixture();
	writeFileSync(join(devkit, "projection.json"), JSON.stringify({ product: { version: "2.0.0" } }));
	writeFileSync(join(devkit, "package.json"), JSON.stringify({ version: "2.0.0" }));
	expect(() => validateElectrobunProjection(devkit)).toThrow(
		`Expected Electrobun SDK version ${version}`,
	);
});

for (const filename of ["projection.json", "package.json"]) {
	test(`rejects missing ${filename}`, () => {
		const devkit = fixture();
		const path = join(devkit, filename);
		rmSync(path);
		expect(() => validateElectrobunProjection(devkit)).toThrow(
			`Electrobun SDK metadata is missing or corrupt: ${path}`,
		);
	});

	test(`rejects corrupt ${filename}`, () => {
		const devkit = fixture();
		const path = join(devkit, filename);
		writeFileSync(path, "{invalid json");
		expect(() => validateElectrobunProjection(devkit)).toThrow(
			`Electrobun SDK metadata is missing or corrupt: ${path}`,
		);
	});
}
