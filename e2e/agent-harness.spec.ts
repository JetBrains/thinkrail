import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
	assertCentralPlaywrightRunner,
	CENTRAL_PLAYWRIGHT_RUNNER_AUTH_ENV,
	createAgentRunPlan,
	WEB_BUILD_READY_ENV,
} from "./agentRunPlan";
import { AMBIENT_PI_CREDENTIAL_ENV_NAMES, stripAmbientPiCredentials } from "./ambientCredentials";
import {
	CENTRAL_STUB_READ_ONLY_ENV,
	DEFAULT_E2E_MODEL,
	isExactE2eModel,
	isRealCentralE2e,
	REAL_CENTRAL_E2E_ENV,
	removeLocalAgentModelAndAuth,
	resolveE2eModel,
	stageGlobalCentralArtifact,
	writeE2eAgentSettings,
} from "./fixtures/centralAgent";
import { resolveBunExecutable } from "./fixtures/executables";
import { countSelectedPlaywrightTests, selectFocusedFullRunPhases } from "./fullRunPlan";
import { signalExitCode } from "./processRunner";

function temporaryDirectory(): string {
	return mkdtempSync(join(tmpdir(), "thinkrail-agent-harness-"));
}

test("agent model parsing preserves provider-qualified ids and rejects malformed targets", () => {
	expect(resolveE2eModel({})).toEqual({ provider: "anthropic", id: "claude-opus-4-8" });
	expect(DEFAULT_E2E_MODEL).toBe("anthropic/claude-opus-4-8");
	expect(resolveE2eModel({ THINKRAIL_E2E_MODEL: "gateway/team/model" })).toEqual({
		provider: "gateway",
		id: "team/model",
	});
	for (const value of ["", "provider", "/model", "provider/"]) {
		expect(() => resolveE2eModel({ THINKRAIL_E2E_MODEL: value })).toThrow(/provider\/modelId/);
	}
});

test("exact model matching never accepts the first model from another provider", () => {
	const target = { provider: "anthropic", id: "same-id" };
	expect(isExactE2eModel({ provider: "anthropic", id: "same-id" }, target)).toBe(true);
	expect(isExactE2eModel({ provider: "local", id: "same-id" }, target)).toBe(false);
	expect(isExactE2eModel({ provider: "anthropic", id: "near-id" }, target)).toBe(false);
	expect(isExactE2eModel(null, target)).toBe(false);
});

test("Central agent staging copies only the restricted artifact and settings", () => {
	const root = temporaryDirectory();
	try {
		const source = join(root, "source.ts");
		const seed = join(root, "seed.ts");
		const artifact = join(root, "home", ".pi", "agent", "extensions", "jetbrains-central.ts");
		const agentDir = join(root, "pi-agent");
		writeFileSync(source, "export default function central() {}\n");
		mkdirSync(agentDir, { recursive: true });
		for (const file of ["auth.json", "models.json", "auth.json.bak", "models.json.bak"]) {
			writeFileSync(join(agentDir, file), "sensitive\n");
		}

		stageGlobalCentralArtifact(source, seed, artifact);
		writeE2eAgentSettings(agentDir, { THINKRAIL_E2E_MODEL: "anthropic/exact-model" });
		removeLocalAgentModelAndAuth(agentDir);

		expect(readFileSync(seed, "utf8")).toBe(readFileSync(source, "utf8"));
		expect(readFileSync(artifact, "utf8")).toBe(readFileSync(source, "utf8"));
		if (process.platform !== "win32") {
			expect(statSync(seed).mode & 0o777).toBe(0o600);
			expect(statSync(artifact).mode & 0o777).toBe(0o600);
		}
		for (const file of ["auth.json", "models.json", "auth.json.bak", "models.json.bak"]) {
			expect(existsSync(join(agentDir, file))).toBe(false);
		}
		expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))).toEqual({
			defaultProvider: "anthropic",
			defaultModel: "exact-model",
			defaultThinkingLevel: "low",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("credential denylist covers every environment name in pi-ai's pinned discovery source", () => {
	const source = readFileSync(
		fileURLToPath(
			new URL(
				"../packages/contracts/node_modules/@earendil-works/pi-ai/dist/env-api-keys.js",
				import.meta.url,
			),
		),
		"utf8",
	);
	const discoveredNames = new Set(
		[...source.matchAll(/"([A-Z][A-Z0-9_]{3,})"/g)]
			.map((match) => match[1])
			.filter((name): name is string => name !== undefined),
	);
	const denied = new Set<string>(AMBIENT_PI_CREDENTIAL_ENV_NAMES);
	expect(discoveredNames.size).toBeGreaterThan(0);
	for (const name of discoveredNames) expect(denied.has(name)).toBe(true);
});

test("ambient credential removal is case-insensitive", () => {
	const env: NodeJS.ProcessEnv = {
		aNtHrOpIc_ApI_kEy: "secret",
		AwS_pRoFiLe: "developer",
		UNRELATED_E2E_ENV: "preserved",
	};
	expect(stripAmbientPiCredentials(env)).toBe(env);
	expect(env).toEqual({ UNRELATED_E2E_ENV: "preserved" });
});

test("Central Playwright execution requires the public runner authorization and skip-build", () => {
	const centralEnv = { [REAL_CENTRAL_E2E_ENV]: "1" };
	expect(() => assertCentralPlaywrightRunner(centralEnv, [])).toThrow(/e2e:agent.*e2e:full/);
	expect(() =>
		assertCentralPlaywrightRunner({ ...centralEnv, THINKRAIL_E2E_SKIP_BUILD: "1" }, []),
	).toThrow(/e2e:agent.*e2e:full/);
	const plan = createAgentRunPlan("bun", [], centralEnv);
	expect(() => assertCentralPlaywrightRunner(plan.env, [])).not.toThrow();
	expect(() => assertCentralPlaywrightRunner(centralEnv, ["--list"])).not.toThrow();
	expect(() => assertCentralPlaywrightRunner({}, [])).not.toThrow();
});

test("agent run plan ignores ambient skip, trusts only internal build readiness, and sanitizes Playwright", () => {
	const ambientCredentials = Object.fromEntries(
		AMBIENT_PI_CREDENTIAL_ENV_NAMES.map((name) => [name, `ambient-${name}`]),
	);
	const sourceEnv: NodeJS.ProcessEnv = {
		...ambientCredentials,
		PATH: "/developer/bin:/usr/bin",
		UNRELATED_E2E_ENV: "preserved",
		THINKRAIL_E2E_SKIP_BUILD: "1",
		THINKRAIL_E2E_LANE: "4",
		PLAYWRIGHT_BLOB_OUTPUT_FILE: "/tmp/report.zip",
	};
	const plan = createAgentRunPlan("/developer/bin/bun", ["e2e/agent.live.spec.ts"], sourceEnv);
	expect(plan.buildCommand).toEqual(["/developer/bin/bun", "run", "build:web"]);
	expect(plan.playwrightCommand).toEqual([
		"/developer/bin/bun",
		"x",
		"playwright",
		"test",
		"e2e/agent.live.spec.ts",
		"--workers=1",
	]);
	expect(plan.env.PATH).toBe(sourceEnv.PATH);
	expect(plan.env.UNRELATED_E2E_ENV).toBe("preserved");
	for (const name of AMBIENT_PI_CREDENTIAL_ENV_NAMES) {
		expect(plan.env[name]).toBeUndefined();
		expect(sourceEnv[name]).toBe(`ambient-${name}`);
	}
	expect(plan.env.THINKRAIL_E2E_SKIP_BUILD).toBe("1");
	expect(plan.env[CENTRAL_PLAYWRIGHT_RUNNER_AUTH_ENV]).toBe("1");
	expect(plan.env[REAL_CENTRAL_E2E_ENV]).toBe("1");
	expect(plan.env.THINKRAIL_E2E_LANE).toBeUndefined();
	expect(plan.env.PLAYWRIGHT_BLOB_OUTPUT_FILE).toBeUndefined();
	expect(plan.env[WEB_BUILD_READY_ENV]).toBeUndefined();
	expect(isRealCentralE2e(plan.env)).toBe(true);
	expect(
		createAgentRunPlan("bun", ["e2e/agent.live.spec.ts"], sourceEnv, {
			webBuildReady: true,
		}).buildCommand,
	).toBeNull();
	expect(createAgentRunPlan("bun", ["--list"], sourceEnv).buildCommand).toBeNull();
});

test("focused full-run planning skips empty phases and rejects an empty selection", () => {
	const report = JSON.stringify({
		suites: [
			{
				specs: [{ tests: [{}, {}] }],
				suites: [{ specs: [{ tests: [{}] }], suites: [] }],
			},
		],
		errors: [],
	});
	const emptyReport = JSON.stringify({
		suites: [],
		errors: [{ message: "Error: No tests found." }],
	});
	expect(countSelectedPlaywrightTests(report)).toBe(3);
	expect(countSelectedPlaywrightTests(emptyReport)).toBe(0);
	expect(selectFocusedFullRunPhases(0, 2)).toEqual(["agent"]);
	expect(selectFocusedFullRunPhases(2, 0)).toEqual(["no-agent"]);
	expect(selectFocusedFullRunPhases(2, 3)).toEqual(["no-agent", "agent"]);
	expect(() => selectFocusedFullRunPhases(0, 0)).toThrow(/No tests matched/);
	expect(() =>
		countSelectedPlaywrightTests(
			JSON.stringify({ suites: [], errors: [{ message: "configuration failed" }] }),
		),
	).toThrow(/configuration failed/);
});

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function forceKillFixtureProcess(pid: number): void {
	for (const target of [-pid, pid]) {
		try {
			process.kill(target, "SIGKILL");
		} catch {}
	}
}

interface SignalTreeState {
	innerRunner: number;
	child: number;
	grandchild: number;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	test(`nested managed runner preserves cleanup and kills every descendant after ${signal}`, async () => {
		test.skip(process.platform === "win32");
		test.setTimeout(10_000);
		const root = temporaryDirectory();
		const statePath = join(root, `signal-tree-${signal}.json`);
		const cleanupPath = join(root, `signal-tree-${signal}.cleaned`);
		const runner = spawn(
			resolveBunExecutable(),
			["e2e/fixtures/nested-signal-runner.ts", statePath, cleanupPath],
			{
				cwd: fileURLToPath(new URL("..", import.meta.url)),
				stdio: "ignore",
			},
		);
		let state: SignalTreeState | null = null;
		try {
			await expect.poll(() => existsSync(statePath), { timeout: 3_000 }).toBe(true);
			const runningState = JSON.parse(readFileSync(statePath, "utf8")) as SignalTreeState;
			state = runningState;
			expect(processExists(runningState.innerRunner)).toBe(true);
			expect(processExists(runningState.child)).toBe(true);
			expect(processExists(runningState.grandchild)).toBe(true);
			const startedAt = Date.now();
			const exited = new Promise<number>((resolve, reject) => {
				runner.once("error", reject);
				runner.once("exit", (code) => resolve(code ?? 1));
			});
			runner.kill(signal);
			await expect
				.poll(() => existsSync(cleanupPath), { intervals: [10], timeout: 400 })
				.toBe(true);
			expect(readFileSync(cleanupPath, "utf8")).toBe("cleaned\n");
			expect(processExists(runningState.grandchild)).toBe(true);
			expect(await exited).toBe(signalExitCode(signal));
			expect(Date.now() - startedAt).toBeLessThan(3_000);
			await expect
				.poll(
					() =>
						!processExists(runningState.innerRunner) &&
						!processExists(runningState.child) &&
						!processExists(runningState.grandchild),
					{ timeout: 3_000 },
				)
				.toBe(true);
		} finally {
			runner.kill("SIGKILL");
			if (state) {
				forceKillFixtureProcess(state.innerRunner);
				forceKillFixtureProcess(state.child);
				forceKillFixtureProcess(state.grandchild);
			}
			rmSync(root, { recursive: true, force: true });
		}
	});
}

test("read-only Central fake permits inspection and rejects mutations", () => {
	test.skip(process.platform === "win32");
	const root = temporaryDirectory();
	try {
		const script = fileURLToPath(new URL("./fixtures/bin/central", import.meta.url));
		const state = join(root, "state");
		const log = join(root, "log");
		writeFileSync(state, "");
		const env = {
			...process.env,
			HOME: root,
			CENTRAL_STUB_STATE: state,
			CENTRAL_STUB_LOG: log,
			[CENTRAL_STUB_READ_ONLY_ENV]: "1",
		};
		expect(spawnSync(script, ["--version"], { env }).status).toBe(0);
		expect(spawnSync(script, ["status"], { env }).status).toBe(0);
		expect(spawnSync(script, ["add", "pi"], { env }).status).toBe(15);
		expect(existsSync(join(root, ".pi", "agent", "extensions", "jetbrains-central.ts"))).toBe(
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
