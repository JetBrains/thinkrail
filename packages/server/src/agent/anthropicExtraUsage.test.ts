import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Credential, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest, WireModel } from "@thinkrail/contracts";
import {
	createSession,
	disableAnthropicExtraUsageWarning,
	disposeAllSessions,
	recheckAnthropicExtraUsage,
	setSessionManagerFactory,
	setSessionModel,
	toWireModel,
} from "./agentSessionManager";
import {
	anthropicSubscriptionAuthActive,
	globalProviderWarnings,
	shouldWarnAnthropicExtraUsage,
} from "./anthropicExtraUsage";
import { configurePiRuntime } from "./piRuntime";
import { setExtUiPublisher } from "./webUiContext";

type Runtime = Parameters<typeof anthropicSubscriptionAuthActive>[0];

function stubRuntime(auth: { check?: "oauth" | "api_key"; apiKey?: string; fails?: boolean }) {
	return {
		checkAuth: async () => {
			if (auth.fails) throw new Error("auth storage unreadable");
			return auth.check ? { type: auth.check } : undefined;
		},
		getAuth: async () => (auth.apiKey ? { auth: { apiKey: auth.apiKey } } : undefined),
	} as unknown as Runtime;
}

const enabled = { getWarnings: () => ({}) };

describe("shouldWarnAnthropicExtraUsage", () => {
	const anthropic = { provider: "anthropic" };

	test("warns for Anthropic OAuth subscription auth", async () => {
		const modelRuntime = stubRuntime({ check: "oauth" });
		expect(
			await shouldWarnAnthropicExtraUsage({
				model: anthropic,
				modelRuntime,
				settingsManager: enabled,
			}),
		).toBe(true);
	});

	test("warns for a subscription token pasted as an API key", async () => {
		const modelRuntime = stubRuntime({ check: "api_key", apiKey: "sk-ant-oat01-abc" });
		expect(
			await shouldWarnAnthropicExtraUsage({
				model: anthropic,
				modelRuntime,
				settingsManager: enabled,
			}),
		).toBe(true);
	});

	test("stays quiet for a normal API key", async () => {
		const modelRuntime = stubRuntime({ check: "api_key", apiKey: "sk-ant-api03-abc" });
		expect(
			await shouldWarnAnthropicExtraUsage({
				model: anthropic,
				modelRuntime,
				settingsManager: enabled,
			}),
		).toBe(false);
	});

	test("stays quiet when pi's warnings.anthropicExtraUsage is off", async () => {
		const modelRuntime = stubRuntime({ check: "oauth" });
		const settingsManager = { getWarnings: () => ({ anthropicExtraUsage: false }) };
		expect(
			await shouldWarnAnthropicExtraUsage({ model: anthropic, modelRuntime, settingsManager }),
		).toBe(false);
	});

	test("stays quiet for other providers and swallows auth lookup failures", async () => {
		const oauth = stubRuntime({ check: "oauth" });
		expect(
			await shouldWarnAnthropicExtraUsage({
				model: { provider: "openai" },
				modelRuntime: oauth,
				settingsManager: enabled,
			}),
		).toBe(false);
		expect(await anthropicSubscriptionAuthActive(stubRuntime({ fails: true }))).toBe(false);
	});
});

const faux = createFauxCore({
	provider: "extra-usage-faux",
	api: "extra-usage-faux",
	models: [
		{
			id: "faux-model",
			name: "faux-model",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 4096,
		},
	],
});

const AMBIENT_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"] as const;

describe("session extra-usage notice", () => {
	let agentDir: string;
	let cwd: string;
	let notices: ExtUiRequest[];
	let credentials: InMemoryCredentialStore;
	let runtime: ModelRuntime;
	const prior = new Map<string, string | undefined>();

	beforeEach(async () => {
		for (const key of ["PI_CODING_AGENT_DIR", "PI_OFFLINE", ...AMBIENT_KEYS])
			prior.set(key, process.env[key]);
		for (const key of AMBIENT_KEYS) delete process.env[key];
		agentDir = mkdtempSync(join(tmpdir(), "thinkrail-extra-usage-agent-"));
		cwd = mkdtempSync(join(tmpdir(), "thinkrail-extra-usage-cwd-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env.PI_OFFLINE = "1";
		credentials = new InMemoryCredentialStore();
		runtime = await ModelRuntime.create({
			credentials,
			modelsPath: null,
			allowModelNetwork: false,
		});
		runtime.registerProvider("extra-usage-faux", {
			api: faux.api,
			baseUrl: "http://extra-usage-faux.test",
			apiKey: "faux",
			streamSimple: faux.streamSimple,
			models: [{ ...faux.getModel(), api: faux.api }],
		});
		configurePiRuntime(runtime);
		setSessionManagerFactory(() => SessionManager.inMemory(cwd));
		notices = [];
		setExtUiPublisher((request) => {
			if (request.kind === "notice") notices.push(request);
		});
	});

	afterEach(() => {
		disposeAllSessions();
		configurePiRuntime(null);
		setSessionManagerFactory((sessionCwd) => SessionManager.create(sessionCwd));
		setExtUiPublisher(() => {});
		for (const [key, value] of prior) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(agentDir, { recursive: true, force: true });
		rmSync(cwd, { recursive: true, force: true });
	});

	async function signIn(credential: Credential): Promise<void> {
		await credentials.modify("anthropic", async () => credential);
		await runtime.refresh({ providers: ["anthropic"] });
	}

	function anthropicModel(): WireModel {
		const model = runtime.getModels("anthropic")[0];
		if (!model) throw new Error("pi ships no Anthropic model");
		return toWireModel(model);
	}

	async function settle(): Promise<void> {
		for (let i = 0; i < 10; i++) await Bun.sleep(5);
	}

	const OAUTH: Credential = {
		type: "oauth",
		access: "sk-ant-oat01-access",
		refresh: "refresh",
		expires: Date.now() + 3_600_000,
	};

	test("warns once per session for OAuth, across model switches and logins", async () => {
		await signIn(OAUTH);
		const { sessionId } = await createSession({
			cwd,
			workspaceId: "ws",
			model: anthropicModel(),
		});
		await settle();
		expect(notices).toEqual([
			expect.objectContaining({ sessionId, kind: "notice", notice: "anthropicExtraUsage" }),
		]);

		await setSessionModel(sessionId, toWireModel(faux.getModel()));
		await setSessionModel(sessionId, anthropicModel());
		recheckAnthropicExtraUsage();
		await settle();
		expect(notices).toHaveLength(1);
	});

	test("warns for an sk-ant-oat token stored as an API key, on switching to Anthropic", async () => {
		await signIn({ type: "api_key", key: "sk-ant-oat01-pasted" });
		const { sessionId } = await createSession({
			cwd,
			workspaceId: "ws",
			model: toWireModel(faux.getModel()),
		});
		await settle();
		expect(notices).toEqual([]);

		await setSessionModel(sessionId, anthropicModel());
		await settle();
		expect(notices).toEqual([
			expect.objectContaining({ sessionId, notice: "anthropicExtraUsage" }),
		]);
	});

	test("stays quiet for a normal Anthropic API key", async () => {
		await signIn({ type: "api_key", key: "sk-ant-api03-normal" });
		await createSession({ cwd, workspaceId: "ws", model: anthropicModel() });
		await settle();
		expect(notices).toEqual([]);
	});

	test("stays quiet when pi's setting is already off", async () => {
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ warnings: { anthropicExtraUsage: false } }),
		);
		await signIn(OAUTH);
		await createSession({ cwd, workspaceId: "ws", model: anthropicModel() });
		await settle();
		expect(notices).toEqual([]);
		expect(globalProviderWarnings()).toEqual({ anthropicExtraUsage: false });
	});

	test("a check still awaiting auth stays quiet when Don't warn again lands first", async () => {
		await signIn({ type: "api_key", key: "sk-ant-api03-normal" });
		await createSession({ cwd, workspaceId: "ws", model: anthropicModel() });
		await settle();
		await signIn(OAUTH);
		const checkAuth = runtime.checkAuth.bind(runtime);
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		runtime.checkAuth = async (...args) => {
			await gate;
			return checkAuth(...args);
		};

		recheckAnthropicExtraUsage();
		await disableAnthropicExtraUsageWarning();
		release();
		await settle();
		expect(notices).toEqual([]);
	});

	test("Don't warn again ignores a malformed project settings file in the host's cwd", async () => {
		const hostCwd = process.cwd();
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "settings.json"), "{ not json");
		process.chdir(cwd);
		try {
			await disableAnthropicExtraUsageWarning();
			expect(globalProviderWarnings()).toEqual({ anthropicExtraUsage: false });
		} finally {
			process.chdir(hostCwd);
		}
	});

	test("Don't warn again writes pi's global setting and silences live sessions", async () => {
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" }));
		await signIn(OAUTH);
		const { sessionId } = await createSession({
			cwd,
			workspaceId: "ws",
			model: toWireModel(faux.getModel()),
		});
		expect(globalProviderWarnings()).toEqual({ anthropicExtraUsage: true });

		await disableAnthropicExtraUsageWarning();
		expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))).toEqual({
			theme: "dark",
			warnings: { anthropicExtraUsage: false },
		});
		expect(globalProviderWarnings()).toEqual({ anthropicExtraUsage: false });

		await setSessionModel(sessionId, anthropicModel());
		await settle();
		expect(notices).toEqual([]);
	});
});
