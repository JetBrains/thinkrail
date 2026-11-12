import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertPinnedPosthogCli,
	POSTHOG_CLI_BINARY_SHA256,
	POSTHOG_CLI_VERSION,
} from "./posthogCli";

test("the pinned checksums belong to the installed @posthog/cli version", () => {
	const { version } = createRequire(import.meta.url)("@posthog/cli/package.json") as {
		version: string;
	};
	expect(version).toBe(POSTHOG_CLI_VERSION);
	expect(
		[...POSTHOG_CLI_BINARY_SHA256.keys()].every((digest) => /^[0-9a-f]{64}$/.test(digest)),
	).toBe(true);
	expect(new Set(POSTHOG_CLI_BINARY_SHA256.values()).size).toBe(POSTHOG_CLI_BINARY_SHA256.size);
});

test("a binary whose checksum is not pinned is refused before it can run", () => {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-posthog-cli-"));
	try {
		const binary = join(dir, "posthog-cli");
		writeFileSync(binary, "#!/bin/sh\necho tampered\n");
		expect(() => assertPinnedPosthogCli(binary)).toThrow("is not a pinned posthog-cli binary");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
