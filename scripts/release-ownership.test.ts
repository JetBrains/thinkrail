import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test("release orchestration has no second public entrypoint", () => {
	for (const name of ["nightly.yml", "stable.yml", "_release.yml", "_build.yml"]) {
		expect(existsSync(resolve(root, ".github/workflows", name))).toBe(false);
	}
});

test("PR and merge-queue qualification remain public", () => {
	const workflow = Bun.YAML.parse(readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8"));
	expect(workflow).toHaveProperty("on.pull_request");
	expect(workflow).toHaveProperty("on.merge_group");
});

test("the private controller can reuse public product recipes", () => {
	for (const path of [
		".github/scripts/next-version.sh",
		".github/actions/build-binary/action.yml",
		".github/actions/codesign/action.yml",
		".github/actions/make-checksums/action.yml",
	]) {
		expect(existsSync(resolve(root, path))).toBe(true);
	}
});
