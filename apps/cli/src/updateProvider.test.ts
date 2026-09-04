import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "@thinkrail/shared/version";
import { createCliUpdateProvider } from "./updateProvider";

function provider(latest?: Parameters<typeof createCliUpdateProvider>[0]["latest"]) {
	const home = mkdtempSync(join(tmpdir(), "trpi-cli-update-"));
	try {
		return createCliUpdateProvider({ env: {}, home, ...(latest ? { latest } : {}) });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

test("a source build advertises nothing it cannot install", () => {
	const p = provider();
	expect(version).toBe("0.0.0-dev");
	expect(p.capabilities).toEqual({
		install: false,
		channelSwitch: "unsupported",
		channels: ["stable", "nightly"],
	});
	expect(p.current).toEqual({ version: "0.0.0-dev", channel: "dev" });
});

test("the CLI host never claims it can restart itself", () => {
	expect(provider().restart).toBeUndefined();
});

test("a release newer than the running build is reported", async () => {
	const p = provider(async () => ({
		version: "9.9.9",
		channel: "stable",
		notesUrl: "https://example.invalid/v9.9.9",
	}));
	expect(await p.check(AbortSignal.timeout(1000))).toEqual({
		version: "9.9.9",
		channel: "stable",
		notesUrl: "https://example.invalid/v9.9.9",
	});
});

test("a release that is not newer is not an update", async () => {
	const p = provider(async () => ({
		version,
		channel: "stable",
		notesUrl: "https://example.invalid/current",
	}));
	expect(await p.check(AbortSignal.timeout(1000))).toBeNull();
});

test("an unpublished channel fails the install instead of running the installer", async () => {
	const p = provider(async () => null);
	expect(await p.install({ channel: "nightly" })).toEqual({
		kind: "failed",
		message: "no nightly release has been published yet",
		retryable: true,
	});
});

test("a wire-supplied version is validated before it can reach installer argv", async () => {
	const p = provider(async () => null);
	const outcome = await p.install({ channel: "stable", version: "1.0.0 --prefix /etc" });
	expect(outcome).toEqual({
		kind: "failed",
		message: "Invalid --version: 1.0.0 --prefix /etc",
		retryable: false,
	});
});
