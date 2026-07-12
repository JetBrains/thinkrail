import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyJbcentralOverrides,
	buildProxyUrls,
	isJbcentralInstalled,
	isJbcentralProxyUrl,
	jbcentralInstallHint,
	type ModelsConfig,
	removeJbcentralOverrides,
	resolveJbcentralBin,
	resolveProxyPort,
} from "./jbcentral";

describe("isJbcentralProxyUrl", () => {
	test("matches jbcentral-managed proxy baseUrls", () => {
		expect(isJbcentralProxyUrl("http://127.0.0.1:19516/wire/s3cr3t/claude-code/anthropic")).toBe(
			true,
		);
		expect(isJbcentralProxyUrl("http://127.0.0.1:4242/wire/abc/codex/openai")).toBe(true);
		expect(isJbcentralProxyUrl("http://localhost:19516/wire/s3cr3t/claude-code/anthropic")).toBe(
			true,
		);
	});

	test("rejects real provider endpoints and junk", () => {
		expect(isJbcentralProxyUrl("https://api.anthropic.com")).toBe(false);
		expect(isJbcentralProxyUrl("https://api.openai.com/v1")).toBe(false);
		// Loopback but not the wire path (some other local proxy).
		expect(isJbcentralProxyUrl("http://127.0.0.1:8080/v1")).toBe(false);
		// `/wire/` on a non-loopback host is someone else's URL, not the local proxy.
		expect(isJbcentralProxyUrl("https://example.com/wire/x")).toBe(false);
		expect(isJbcentralProxyUrl(undefined)).toBe(false);
		expect(isJbcentralProxyUrl("")).toBe(false);
		expect(isJbcentralProxyUrl("not a url")).toBe(false);
	});
});

describe("resolveProxyPort", () => {
	test("env wins over config over default", () => {
		expect(resolveProxyPort({ WIRE_PROXY_PORT: "20000" }, { proxy_port: 30000 })).toBe(20000);
		expect(resolveProxyPort({}, { proxy_port: 30000 })).toBe(30000);
		expect(resolveProxyPort({}, {})).toBe(19516);
	});

	test("empty env value falls through to config/default", () => {
		expect(resolveProxyPort({ WIRE_PROXY_PORT: "" }, { proxy_port: 30000 })).toBe(30000);
		expect(resolveProxyPort({ WIRE_PROXY_PORT: "" }, {})).toBe(19516);
	});

	test("rejects a non-numeric or out-of-range env port", () => {
		expect(() => resolveProxyPort({ WIRE_PROXY_PORT: "nope" }, {})).toThrow(
			"Invalid WIRE_PROXY_PORT: nope",
		);
		expect(() => resolveProxyPort({ WIRE_PROXY_PORT: "70000" }, {})).toThrow(
			"Invalid WIRE_PROXY_PORT: 70000",
		);
	});
});

describe("buildProxyUrls", () => {
	test("composes the per-provider proxy URLs (no /v1)", () => {
		expect(buildProxyUrls(19516, "sEcReT")).toEqual({
			anthropicUrl: "http://127.0.0.1:19516/wire/sEcReT/claude-code/anthropic",
			openaiUrl: "http://127.0.0.1:19516/wire/sEcReT/codex/openai",
		});
	});

	// Drift gate: the server detects jbcentral wiring via `isJbcentralProxyUrl`. If the URL shape this writer
	// produces ever stops matching that reader, provider status would silently report "API key" instead of
	// "JetBrains AI proxy" — this pins the two together (now co-located in the same module).
	test("built URLs satisfy the detection predicate", () => {
		const urls = buildProxyUrls(19516, "sEcReT");
		expect(isJbcentralProxyUrl(urls.anthropicUrl)).toBe(true);
		expect(isJbcentralProxyUrl(urls.openaiUrl)).toBe(true);
	});
});

describe("applyJbcentralOverrides", () => {
	const urls = buildProxyUrls(19516, "s");

	test("sets baseUrl + apiKey on anthropic and openai", () => {
		const config = applyJbcentralOverrides({}, urls);
		expect(config.providers?.anthropic).toEqual({
			baseUrl: urls.anthropicUrl,
			apiKey: "wire-proxy",
		});
		expect(config.providers?.openai).toEqual({ baseUrl: urls.openaiUrl, apiKey: "wire-proxy" });
	});

	test("preserves other provider fields + unrelated providers", () => {
		const config: ModelsConfig = {
			providers: {
				anthropic: { models: ["x"] } as never,
				custom: { baseUrl: "keep" },
			},
		};
		applyJbcentralOverrides(config, urls);
		expect(config.providers?.anthropic).toEqual({
			models: ["x"],
			baseUrl: urls.anthropicUrl,
			apiKey: "wire-proxy",
		} as never);
		expect(config.providers?.custom).toEqual({ baseUrl: "keep" });
	});
});

describe("removeJbcentralOverrides", () => {
	test("drops only baseUrl/apiKey, keeping other fields", () => {
		const config: ModelsConfig = {
			providers: {
				anthropic: { baseUrl: "x", apiKey: "y", models: ["m"] } as never,
				openai: { baseUrl: "x", apiKey: "y" },
			},
		};
		removeJbcentralOverrides(config);
		expect(config.providers?.anthropic).toEqual({ models: ["m"] } as never);
		// openai had only the managed fields → the now-empty entry is removed.
		expect(config.providers?.openai).toBeUndefined();
	});

	test("is a no-op when there are no providers", () => {
		expect(removeJbcentralOverrides({})).toEqual({});
	});
});

describe("resolveJbcentralBin (install detection)", () => {
	const origPath = process.env.PATH;
	const origHome = process.env.HOME;
	let tmp: string | undefined;

	afterEach(() => {
		process.env.PATH = origPath;
		process.env.HOME = origHome;
		if (tmp) rmSync(tmp, { recursive: true, force: true });
		tmp = undefined;
	});

	test("finds `central` in ~/.local/bin even when it's not on PATH (the installer's default)", () => {
		// Regression for the "installed but Recheck did nothing" bug: the CLI is now named `central` (not
		// `jbcentral`), and the curl installer drops it in ~/.local/bin without adding that to PATH — so the
		// old PATH-only `Bun.which("jbcentral")` never saw it. PATH is emptied to isolate the fallback.
		tmp = mkdtempSync(join(tmpdir(), "jbc-home-"));
		const binDir = join(tmp, ".local", "bin");
		mkdirSync(binDir, { recursive: true });
		const bin = join(binDir, "central");
		writeFileSync(bin, "#!/bin/sh\n");
		chmodSync(bin, 0o755);

		process.env.PATH = "";
		process.env.HOME = tmp;
		expect(resolveJbcentralBin()).toBe(bin);
		expect(isJbcentralInstalled()).toBe(true);
	});

	test("still finds the legacy `jbcentral` name when that's all that's present", () => {
		tmp = mkdtempSync(join(tmpdir(), "jbc-home-"));
		const binDir = join(tmp, ".local", "bin");
		mkdirSync(binDir, { recursive: true });
		const bin = join(binDir, "jbcentral");
		writeFileSync(bin, "#!/bin/sh\n");
		chmodSync(bin, 0o755);

		process.env.PATH = "";
		process.env.HOME = tmp;
		expect(resolveJbcentralBin()).toBe(bin);
	});

	test("null when the CLI is neither on PATH nor in ~/.local/bin", () => {
		tmp = mkdtempSync(join(tmpdir(), "jbc-home-"));
		process.env.PATH = "";
		process.env.HOME = tmp;
		expect(resolveJbcentralBin()).toBeNull();
		expect(isJbcentralInstalled()).toBe(false);
	});
});

describe("jbcentralInstallHint", () => {
	// Pins the exact install URL the web `JetBrainsAiCard` mirrors as `INSTALL_CMD` (web can't import shared).
	// If this URL changes, this test flags it so the web copy is updated in the same change.
	const INSTALL_URL =
		"https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/jbcentral/stable/install.sh";

	test("unix points at the install.sh one-liner (exact URL — mirrored in the web card)", () => {
		expect(jbcentralInstallHint("linux")).toContain(`curl -fsSL ${INSTALL_URL} | bash`);
		expect(jbcentralInstallHint("darwin")).toContain(`curl -fsSL ${INSTALL_URL} | bash`);
	});

	test("windows points at the JetBrains installer, not the sh script", () => {
		const hint = jbcentralInstallHint("win32");
		expect(hint).toContain("Windows");
		expect(hint).not.toContain("install.sh");
	});
});
