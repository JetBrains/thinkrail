import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "@thinkrail/shared/version";
import { installConfigDir } from "./paths";
import { createCliUpdateProvider } from "./updateProvider";

function provider(latest?: Parameters<typeof createCliUpdateProvider>[0]["latest"]) {
	const home = mkdtempSync(join(tmpdir(), "trpi-cli-update-"));
	try {
		return createCliUpdateProvider({ env: {}, home, ...(latest ? { latest } : {}) });
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

function providerAt(input: { home: string; prefix?: string; execPath: string }) {
	if (input.prefix) {
		mkdirSync(installConfigDir(input.home), { recursive: true });
		writeFileSync(
			join(installConfigDir(input.home), "install.json"),
			JSON.stringify({ channel: "stable", prefix: input.prefix }),
		);
	}
	return createCliUpdateProvider({
		env: {},
		home: input.home,
		execPath: input.execPath,
		platform: "linux",
	});
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

test("the installation identity names the binary this provider would replace", () => {
	const home = mkdtempSync(join(tmpdir(), "trpi-cli-update-"));
	try {
		const p = providerAt({
			home,
			prefix: "/opt/thinkrail",
			execPath: "/opt/thinkrail/bin/thinkrail",
		});
		expect(p.installationId).toBe("cli:/opt/thinkrail/bin/thinkrail");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("a build running from somewhere other than its recorded install refuses to install", () => {
	const home = mkdtempSync(join(tmpdir(), "trpi-cli-update-"));
	try {
		// The metadata names prefix B while this process runs A: installing would replace B and
		// leave A untouched, so the host must not offer it.
		const p = providerAt({ home, prefix: "/opt/b", execPath: "/opt/a/bin/thinkrail" });
		expect(p.capabilities.install).toBe(false);
		expect(p.capabilities.channelSwitch).toBe("unsupported");
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("an install refuses when the recorded install no longer points at this program", async () => {
	const home = mkdtempSync(join(tmpdir(), "trpi-cli-update-"));
	try {
		// The metadata this provider resolved at boot, then a manual install rewrote install.json to
		// another prefix: installing now would replace that copy and report this one as staged.
		const p = providerAt({ home, prefix: "/opt/a", execPath: "/opt/a/bin/thinkrail" });
		writeFileSync(
			join(installConfigDir(home), "install.json"),
			JSON.stringify({ channel: "stable", prefix: "/opt/b" }),
		);
		expect(await p.install({ channel: "stable", version: "1.0.0" })).toEqual({
			kind: "failed",
			message:
				"the recorded ThinkRail install moved since this host started — install it again from a terminal",
			retryable: false,
		});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
