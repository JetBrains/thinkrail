import { spawnSync } from "node:child_process";
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
import { createAgentRunPlan } from "./agentRunPlan";
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

test("agent run plan builds before Playwright and enables isolated Central mode", () => {
	const sourceEnv = {
		PATH: "/developer/bin:/usr/bin",
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
	expect(plan.env.THINKRAIL_E2E_SKIP_BUILD).toBe("1");
	expect(plan.env[REAL_CENTRAL_E2E_ENV]).toBe("1");
	expect(plan.env.THINKRAIL_E2E_LANE).toBeUndefined();
	expect(plan.env.PLAYWRIGHT_BLOB_OUTPUT_FILE).toBeUndefined();
	expect(isRealCentralE2e(plan.env)).toBe(true);
	expect(createAgentRunPlan("bun", ["--list"], sourceEnv).buildCommand).toBeNull();
});

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
