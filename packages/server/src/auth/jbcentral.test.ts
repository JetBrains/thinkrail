import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	configurePiRuntime,
	configurePiRuntimeFactory,
	createSession,
	disposeAllSessions,
	getSessionMessages,
	listAvailableModels,
	promptSession,
	resetPiRuntimeReconciliationForTests,
	setSessionManagerFactory,
	toWireModel,
} from "../agent";
import {
	connectJbcentral,
	disconnectJbcentral,
	getJbcentralStatus,
	initializeJbcentralRuntime,
	jbcentralLogin,
	resetJbcentralStateForTests,
	updateJbcentral,
} from "./jbcentral";
import { getProviderStatus } from "./providerStatus";

const syntheticExtension = `
const model = (id) => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 4096,
});
export default function syntheticCentralExtension(pi) {
  pi.registerProvider("central-test", {
    api: "openai-completions",
    baseUrl: "https://synthetic-central.invalid",
    apiKey: "synthetic-test-key",
    models: [{ ...model("central-model"), api: "openai-completions" }],
  });
  pi.registerProvider("legacy-faux", {
    api: "legacy-faux",
    baseUrl: "https://synthetic-legacy.invalid",
    apiKey: "synthetic-test-key",
    streamSimple() { throw new Error("synthetic test provider never dispatches"); },
    models: [{ ...model("legacy-model"), api: "legacy-faux" }],
  });
}
`;

const fakeCentral = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$THINKRAIL_CENTRAL_TEST_LOG"
case "$1" in
  --version)
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/unreviewed" ]; then
      printf 'central 1.7.0 (independently-authored test metadata)\\n'
    else
      printf 'central 1.6.2 (independently-authored test metadata)\\n'
    fi
    ;;
  add)
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/add-fail" ]; then
      printf 'synthetic-sensitive-child-output\\n' >&2
      exit 9
    fi
    while [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/add-wait" ]; do sleep 0.01; done
    mkdir -p "$HOME/.pi/agent/extensions"
    cp "$THINKRAIL_CENTRAL_TEST_EXTENSION_SOURCE" "$HOME/.pi/agent/extensions/jetbrains-central.ts"
    ;;
  remove)
    rm -f "$HOME/.pi/agent/extensions/jetbrains-central.ts"
    ;;
  update)
    ;;
  login)
    ;;
  *)
    exit 8
    ;;
esac
`;

function modelDef(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

const legacyFaux = createFauxCore({
	provider: "legacy-faux",
	api: "legacy-faux",
	models: [modelDef("legacy-model")],
	tokensPerSecond: 2_000,
});

async function legacyRuntime(): Promise<ModelRuntime> {
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("legacy-faux", {
		api: legacyFaux.api,
		baseUrl: "http://legacy-faux.test",
		apiKey: "faux",
		streamSimple: legacyFaux.streamSimple,
		models: [{ ...modelDef("legacy-model"), api: legacyFaux.api }],
	});
	return runtime;
}

let root: string;
let home: string;
let agentDir: string;
let controlDir: string;
let logPath: string;
let extensionSource: string;
let artifactPath: string;
let priorEnv: Record<string, string | undefined>;

function control(name: string, present: boolean): void {
	const path = join(controlDir, name);
	if (present) writeFileSync(path, "1\n");
	else rmSync(path, { force: true });
}

function commandLog(): string[] {
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
}

async function pollStatus(state: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if ((await getJbcentralStatus()).state === state) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`Central status did not reach ${state}`);
}

beforeEach(async () => {
	priorEnv = {
		HOME: process.env.HOME,
		PATH: process.env.PATH,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		PI_OFFLINE: process.env.PI_OFFLINE,
		THINKRAIL_CENTRAL_TEST_LOG: process.env.THINKRAIL_CENTRAL_TEST_LOG,
		THINKRAIL_CENTRAL_TEST_CONTROL: process.env.THINKRAIL_CENTRAL_TEST_CONTROL,
		THINKRAIL_CENTRAL_TEST_EXTENSION_SOURCE: process.env.THINKRAIL_CENTRAL_TEST_EXTENSION_SOURCE,
	};
	await resetJbcentralStateForTests();
	resetPiRuntimeReconciliationForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);

	root = mkdtempSync(join(tmpdir(), "thinkrail-central-auth-"));
	home = join(root, "home");
	agentDir = join(root, "custom-agent");
	controlDir = join(root, "control");
	logPath = join(root, "central.log");
	extensionSource = join(root, "synthetic-central.ts");
	artifactPath = join(home, ".pi", "agent", "extensions", "jetbrains-central.ts");
	const binDir = join(root, "bin");
	mkdirSync(binDir, { recursive: true });
	mkdirSync(home, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(controlDir, { recursive: true });
	writeFileSync(extensionSource, syntheticExtension);
	writeFileSync(join(binDir, "central"), fakeCentral);
	chmodSync(join(binDir, "central"), 0o755);

	process.env.HOME = home;
	process.env.PATH = `${binDir}:${priorEnv.PATH ?? ""}`;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	process.env.THINKRAIL_CENTRAL_TEST_LOG = logPath;
	process.env.THINKRAIL_CENTRAL_TEST_CONTROL = controlDir;
	process.env.THINKRAIL_CENTRAL_TEST_EXTENSION_SOURCE = extensionSource;
	setSessionManagerFactory(() => SessionManager.inMemory(root));
	await initializeJbcentralRuntime();
});

afterEach(async () => {
	disposeAllSessions();
	await resetJbcentralStateForTests();
	resetPiRuntimeReconciliationForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	for (const [name, value] of Object.entries(priorEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

describe("native Central auth transaction", () => {
	test("connect uses the global opaque artifact with a custom PI agent dir", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(existsSync(artifactPath)).toBe(true);
		expect((await getJbcentralStatus()).state).toBe("configured");
		expect((await listAvailableModels()).map((model) => model.id)).toContain("central-model");
		expect(commandLog()).toContain("add pi");
		expect(commandLog().some((line) => line.includes(" pi ") && line !== "add pi")).toBe(false);
	});

	test("an accepted turn settles before Central add executes and the caller receives pending", async () => {
		configurePiRuntime(await legacyRuntime());
		legacyFaux.setResponses([fauxAssistantMessage("initial")]);
		const session = await createSession({
			cwd: root,
			workspaceId: "workspace-pending",
			model: toWireModel(legacyFaux.getModel()),
		});
		await promptSession(session.sessionId, "initial turn");

		let releaseTurn: (() => void) | undefined;
		const turnRelease = new Promise<void>((resolve) => {
			releaseTurn = resolve;
		});
		legacyFaux.appendResponses([
			async () => {
				await turnRelease;
				return fauxAssistantMessage("settled before Central mutation");
			},
		]);
		const turn = promptSession(session.sessionId, "active turn");
		const connect = connectJbcentral();
		expect(await connect).toEqual({ outcome: "pending" });
		expect(commandLog()).not.toContain("add pi");
		releaseTurn?.();
		await turn;
		await pollStatus("configured");
		expect(commandLog()).toContain("add pi");
		const hydrated = await getSessionMessages(session.sessionId, "workspace-pending", root);
		expect(hydrated.summary.sessionId).toBe(session.sessionId);
		expect(hydrated.summary.model).toMatchObject({
			provider: "legacy-faux",
			id: "legacy-model",
		});
	});

	test("disconnect blocks exact Central-only models, compensates add, and restores a fresh generation", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		const centralModel = (await listAvailableModels()).find(
			(model) => model.id === "central-model",
		);
		if (!centralModel) throw new Error("synthetic Central model missing");
		const session = await createSession({
			cwd: root,
			workspaceId: "workspace-blocked",
			model: centralModel,
		});

		expect(await disconnectJbcentral()).toEqual({
			outcome: "blocked",
			reason: "model-unavailable",
			affectedSessionIds: [session.sessionId],
		});
		expect(existsSync(artifactPath)).toBe(true);
		expect(commandLog().slice(-2)).toEqual(["remove pi", "add pi"]);
		expect(await getJbcentralStatus()).toEqual({
			state: "blocked",
			action: "disconnect",
			reason: "model-unavailable",
			affectedSessionIds: [session.sessionId],
		});
		expect((await listAvailableModels()).map((model) => model.id)).toContain("central-model");
	});

	test("does not run login or update for an unreviewed Central version", async () => {
		control("unreviewed", true);
		expect(await jbcentralLogin()).toEqual({ outcome: "failed", reason: "unsupported-version" });
		expect(await updateJbcentral()).toEqual({ outcome: "failed", reason: "unsupported-version" });
		expect(commandLog()).not.toContain("login");
		expect(commandLog()).not.toContain("update --install");
	});

	test("maps child failure to a closed reason without exposing output", async () => {
		control("add-fail", true);
		const result = await connectJbcentral();
		expect(result).toEqual({ outcome: "failed", reason: "central-action-failed" });
		expect(JSON.stringify(result)).not.toContain("synthetic-sensitive-child-output");
		expect(existsSync(artifactPath)).toBe(false);
	});

	test("rolls back only this connect's legacy fields when candidate loading fails", async () => {
		const modelsPath = join(agentDir, "models.json");
		const legacyProvider = {
			baseUrl: "http://127.0.0.1:19516/wire/test-token/pi/anthropic",
			apiKey: "wire-proxy",
			keep: "untouched",
		};
		writeFileSync(
			modelsPath,
			`${JSON.stringify({ providers: { anthropic: legacyProvider }, keepTopLevel: true }, null, 2)}\n`,
		);
		const privateDiagnostic = "synthetic-private-extension-diagnostic";
		writeFileSync(extensionSource, `throw new Error("${privateDiagnostic}");\n`);

		const result = await connectJbcentral();
		expect(result).toEqual({ outcome: "failed", reason: "candidate-failed" });
		expect(JSON.stringify(result)).not.toContain(privateDiagnostic);
		expect(JSON.parse(readFileSync(modelsPath, "utf8"))).toEqual({
			providers: { anthropic: legacyProvider },
			keepTopLevel: true,
		});
	});

	test("fails closed on invalid legacy JSON after add and exposes only a typed reason", async () => {
		const modelsPath = join(agentDir, "models.json");
		writeFileSync(modelsPath, "not-json\n");
		expect(await connectJbcentral()).toEqual({
			outcome: "failed",
			reason: "legacy-cleanup-invalid",
		});
		expect(readFileSync(modelsPath, "utf8")).toBe("not-json\n");
		expect(await getJbcentralStatus()).toEqual({
			state: "recovery-required",
			action: "connect",
			reason: "legacy-cleanup-invalid",
		});
		await expect(listAvailableModels()).rejects.toThrow("reconciliation is pending");

		writeFileSync(modelsPath, "{}\n");
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect((await listAvailableModels()).map((model) => model.id)).toContain("central-model");
	});

	test("serializes opposite actions through their complete reconciliations", async () => {
		control("add-wait", true);
		const connect = connectJbcentral();
		for (let attempt = 0; attempt < 100 && !commandLog().includes("add pi"); attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		const disconnect = disconnectJbcentral();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(commandLog()).not.toContain("remove pi");
		control("add-wait", false);
		expect(await connect).toEqual({ outcome: "applied" });
		expect(await disconnect).toEqual({ outcome: "applied" });
		expect(commandLog().filter((line) => line === "add pi" || line === "remove pi")).toEqual([
			"add pi",
			"remove pi",
		]);
	});

	test("a failed disconnect compensation seals runtime consumers but keeps recovery status visible", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		const centralModel = (await listAvailableModels()).find(
			(model) => model.id === "central-model",
		);
		if (!centralModel) throw new Error("synthetic Central model missing");
		await createSession({ cwd: root, workspaceId: "workspace-recovery", model: centralModel });
		control("add-fail", true);

		expect(await disconnectJbcentral()).toEqual({
			outcome: "failed",
			reason: "recovery-failed",
		});
		expect(await getJbcentralStatus()).toEqual({
			state: "recovery-required",
			action: "disconnect",
			reason: "recovery-failed",
		});
		await expect(listAvailableModels()).rejects.toThrow("reconciliation is pending");
		expect(await getProviderStatus()).toMatchObject({
			providers: [],
			jbcentral: { state: "recovery-required", reason: "recovery-failed" },
		});

		// A failed repair must not accidentally open the prior generation just because its boundary ended.
		expect(await connectJbcentral()).toEqual({
			outcome: "failed",
			reason: "central-action-failed",
		});
		expect(await getJbcentralStatus()).toEqual({
			state: "recovery-required",
			action: "disconnect",
			reason: "recovery-failed",
		});
		await expect(listAvailableModels()).rejects.toThrow("reconciliation is pending");

		control("add-fail", false);
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect((await listAvailableModels()).map((model) => model.id)).toContain("central-model");
	});
});
