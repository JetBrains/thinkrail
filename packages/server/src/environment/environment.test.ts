import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { applyHostEnvironment, hostEnvironmentStatus, updateHostEnvironment } from "./index";

const originalDataDir = process.env.THINKRAIL_DATA_DIR;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const TEST_VARS = ["TR_ENV_A", "TR_ENV_B", "tr_env_b"];
let dataDir: string;
let agentDir: string;

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[Symbol.for("thinkrail.shellEnv.launchKeys")];
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-env-data-"));
	agentDir = mkdtempSync(join(tmpdir(), "thinkrail-env-agent-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	delete process.env.PI_CODING_AGENT_DIR;
	applyHostEnvironment();
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(agentDir, { recursive: true, force: true });
	for (const name of TEST_VARS) delete process.env[name];
	if (originalDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = originalDataDir;
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

test("an update with invalid entries is rejected whole and nothing is saved", () => {
	const result = updateHostEnvironment({
		agentDir: "relative/dir",
		vars: [
			{ name: "1BAD", value: "x" },
			{ name: "PATH", value: "x" },
			{ name: "thinkrail_port", value: "x" },
			{ name: "TR_ENV_A", value: "1" },
			{ name: "TR_ENV_A", value: "2" },
		],
	});
	expect(result).toEqual({
		ok: false,
		issues: [
			{ field: "agentDir", code: "notAbsolute" },
			{ field: "var", index: 0, code: "invalidName" },
			{ field: "var", index: 1, code: "reserved" },
			{ field: "var", index: 2, code: "reserved" },
			{ field: "var", index: 4, code: "duplicate" },
		],
	});
	expect(hostEnvironmentStatus().stored).toEqual({ vars: [] });
});

test("a missing or non-directory agent dir is named", () => {
	const file = join(agentDir, "file");
	writeFileSync(file, "");
	expect(updateHostEnvironment({ agentDir: join(agentDir, "gone"), vars: [] })).toEqual({
		ok: false,
		issues: [{ field: "agentDir", code: "notFound" }],
	});
	expect(updateHostEnvironment({ agentDir: file, vars: [] })).toEqual({
		ok: false,
		issues: [{ field: "agentDir", code: "notDirectory" }],
	});
});

test("a malformed record is a thrown request error, not a validation result", () => {
	expect(() => updateHostEnvironment({ vars: [{ name: 1, value: "x" }] })).toThrow();
	expect(() => updateHostEnvironment(null)).toThrow();
});

test("a saved update is private on disk, drops blank rows and requires a restart", () => {
	const result = updateHostEnvironment({
		agentDir: ` ${agentDir} `,
		vars: [
			{ name: " TR_ENV_A ", value: "a" },
			{ name: "", value: "" },
		],
	});
	expect(result).toMatchObject({
		ok: true,
		status: {
			stored: { agentDir, vars: [{ name: "TR_ENV_A", value: "a" }] },
			restartRequired: true,
		},
	});
	const file = join(dataDir, "environment.json");
	expect(statSync(file).mode & 0o777).toBe(0o600);
	expect(JSON.parse(readFileSync(file, "utf8")).vars).toEqual([{ name: "TR_ENV_A", value: "a" }]);
	expect(process.env.TR_ENV_A).toBeUndefined();

	applyHostEnvironment();
	expect(process.env.TR_ENV_A).toBe("a");
	expect(process.env.PI_CODING_AGENT_DIR).toBe(agentDir);
	expect(hostEnvironmentStatus()).toMatchObject({
		restartRequired: false,
		effectiveAgentDir: agentDir,
	});
});

test("a launch variable wins and is reported as overridden", () => {
	process.env.TR_ENV_B = "launch";
	process.env.PI_CODING_AGENT_DIR = "/launch/agent";
	updateHostEnvironment({ agentDir, vars: [{ name: "TR_ENV_B", value: "stored" }] });
	applyHostEnvironment();
	expect(process.env.TR_ENV_B).toBe("launch");
	expect(process.env.PI_CODING_AGENT_DIR).toBe("/launch/agent");
	expect(hostEnvironmentStatus().launchOverridden).toEqual(["PI_CODING_AGENT_DIR", "TR_ENV_B"]);
});

test("a tilde agent dir is expanded against the home directory", () => {
	updateHostEnvironment({ agentDir: "~", vars: [] });
	applyHostEnvironment();
	expect(process.env.PI_CODING_AGENT_DIR).toBe(homedir());
});

test("an entry that turned invalid on disk is skipped at boot, the rest applies", () => {
	writeFileSync(
		join(dataDir, "environment.json"),
		JSON.stringify({
			agentDir: join(agentDir, "deleted"),
			vars: [
				{ name: "HOME", value: "/elsewhere" },
				{ name: "TR_ENV_A", value: "kept" },
			],
		}),
	);
	const home = process.env.HOME;
	applyHostEnvironment();
	expect(process.env.HOME).toBe(home);
	expect(process.env.TR_ENV_A).toBe("kept");
	expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined();
	expect(hostEnvironmentStatus().launchOverridden).toEqual([]);
});

test("on Windows names match case-insensitively for launch overrides and duplicates", () => {
	applyHostEnvironment({ platform: "win32" });
	expect(
		updateHostEnvironment({
			vars: [
				{ name: "TR_ENV_A", value: "1" },
				{ name: "tr_env_a", value: "2" },
			],
		}),
	).toEqual({ ok: false, issues: [{ field: "var", index: 1, code: "duplicate" }] });

	process.env.tr_env_b = "launch";
	updateHostEnvironment({ vars: [{ name: "TR_ENV_B", value: "stored" }] });
	applyHostEnvironment({ platform: "win32" });
	expect(process.env.TR_ENV_B).toBeUndefined();
	expect(process.env.tr_env_b).toBe("launch");
	expect(hostEnvironmentStatus().launchOverridden).toEqual(["TR_ENV_B"]);
});

test("elsewhere names stay case-sensitive", () => {
	applyHostEnvironment({ platform: "linux" });
	process.env.tr_env_b = "launch";
	updateHostEnvironment({ vars: [{ name: "TR_ENV_B", value: "stored" }] });
	applyHostEnvironment({ platform: "linux" });
	expect(process.env.TR_ENV_B).toBe("stored");
	expect(hostEnvironmentStatus().launchOverridden).toEqual([]);
});
