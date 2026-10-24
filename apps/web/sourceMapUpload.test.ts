import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSourceMaps, sourceMapRelease } from "./sourceMapUpload";

test("source maps are produced only for a credentialed release build", () => {
	expect(sourceMapRelease({})).toBeNull();
	expect(sourceMapRelease({ THINKRAIL_SOURCEMAPS_RELEASE: " " })).toBeNull();
	expect(() => sourceMapRelease({ THINKRAIL_SOURCEMAPS_RELEASE: "1.2.3" })).toThrow(
		"POSTHOG_CLI_API_KEY",
	);
	expect(
		sourceMapRelease({
			THINKRAIL_SOURCEMAPS_RELEASE: "1.2.3",
			POSTHOG_CLI_API_KEY: "phx_x",
			POSTHOG_CLI_PROJECT_ID: "1",
		}),
	).toBe("1.2.3");
});

test("leftover maps are found anywhere in the build output", () => {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-maps-"));
	try {
		mkdirSync(join(dir, "assets", "nested"), { recursive: true });
		writeFileSync(join(dir, "assets", "a.js"), "");
		writeFileSync(join(dir, "assets", "nested", "b.js.map"), "{}");
		expect(listSourceMaps(dir)).toEqual([join(dir, "assets", "nested", "b.js.map")]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
