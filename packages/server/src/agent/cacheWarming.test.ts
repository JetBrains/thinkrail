import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { CodedError } from "@thinkrail/shared/codedError";
import {
	applyCacheWarmingDefault,
	readCacheWarmingSetting,
	writeCacheWarmingMode,
} from "./cacheWarming";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "thinkrail-cache-warming-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(agentDir, { recursive: true, force: true });
});

const settingsPath = () => join(agentDir, "settings.json");
const readSettings = () =>
	JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;

test("pi 1.5.1 defaults to idle warming; the host default in front of the getter keeps streaming", () => {
	const pi = SettingsManager.create(process.cwd(), agentDir);
	expect(pi.getCacheWarmingMode()).toBe("idle");
	applyCacheWarmingDefault(pi);
	expect(pi.getCacheWarmingMode()).toBe("streaming");
	expect(readCacheWarmingSetting()).toEqual({ mode: "streaming", source: "default" });
});

test("an explicit mode in pi's settings.json wins over the host default, an unknown one does not", () => {
	writeFileSync(settingsPath(), JSON.stringify({ cacheWarming: "idle" }));
	const explicit = SettingsManager.create(process.cwd(), agentDir);
	applyCacheWarmingDefault(explicit);
	expect(explicit.getCacheWarmingMode()).toBe("idle");
	expect(readCacheWarmingSetting()).toEqual({ mode: "idle", source: "user" });

	writeFileSync(settingsPath(), JSON.stringify({ cacheWarming: "always" }));
	const unknown = SettingsManager.create(process.cwd(), agentDir);
	applyCacheWarmingDefault(unknown);
	expect(unknown.getCacheWarmingMode()).toBe("streaming");
	expect(readCacheWarmingSetting()).toEqual({ mode: "streaming", source: "default" });
});

test("writing a mode keeps the rest of settings.json and reports back as the user's choice", async () => {
	writeFileSync(settingsPath(), JSON.stringify({ defaultProvider: "anthropic", theme: "dark" }));
	expect(await writeCacheWarmingMode("off")).toEqual({ mode: "off", source: "user" });
	expect(readSettings()).toEqual({
		defaultProvider: "anthropic",
		theme: "dark",
		cacheWarming: "off",
	});
	expect(readCacheWarmingSetting()).toEqual({ mode: "off", source: "user" });

	await writeCacheWarmingMode("idle");
	expect(readSettings().cacheWarming).toBe("idle");
});

test("a settings.json pi cannot parse refuses the write instead of pi's silent skip", async () => {
	writeFileSync(settingsPath(), "{ not json");
	let error: unknown;
	try {
		await writeCacheWarmingMode("off");
	} catch (caught) {
		error = caught;
	}
	expect(error).toBeInstanceOf(CodedError);
	expect((error as CodedError).code).toBe("CACHE_WARMING_WRITE_FAILED");
	expect(readFileSync(settingsPath(), "utf8")).toBe("{ not json");
});

test("an unknown mode is refused before anything is written", async () => {
	await expect(writeCacheWarmingMode("always" as never)).rejects.toMatchObject({
		code: "CACHE_WARMING_WRITE_FAILED",
	});
	expect(() => readFileSync(settingsPath())).toThrow();
});
