import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
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
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { JBCENTRAL_STATUS_TTL_MS } from "@thinkrail/shared/jbcentral";
import {
	configurePiRuntime,
	configurePiRuntimeFactory,
	createSession,
	disposeAllSessions,
	getSessionMessages,
	listAvailableModels,
	setSessionManagerFactory,
	usePiRuntime,
} from "../agent";
import {
	connectJbcentral,
	disconnectJbcentral,
	getJbcentralAccessSources,
	getJbcentralQuota,
	getJbcentralStatus,
	initializeJbcentralRuntime,
	jbcentralLogin,
	resetJbcentralStateForTests,
	setJbcentralChangedPublisher,
	startProxyJbcentral,
	switchJbcentralAccess,
	updateJbcentral,
} from "./jbcentral";
import { getProviderStatus } from "./providerStatus";

function syntheticExtension(modelId: string): string {
	return `
const model = {
  id: ${JSON.stringify(modelId)},
  name: ${JSON.stringify(modelId)},
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 4096,
};
export default function syntheticCentralExtension(pi) {
  pi.registerProvider("anthropic", {
    baseUrl: "https://synthetic-central.invalid/anthropic",
    apiKey: "synthetic-proxy-key",
    name: "synthetic-sensitive-provider-name",
  });
  pi.registerProvider("central-test", {
    api: "openai-completions",
    baseUrl: "https://synthetic-central.invalid",
    apiKey: "synthetic-test-key",
    models: [{ ...model, api: "openai-completions" }],
  });
}
`;
}

const fakeCentral = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$THINKRAIL_CENTRAL_TEST_LOG"
case "$1" in
  --version)
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/malformed" ]; then
      printf 'synthetic-sensitive-version-output\\n'
    elif [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/outdated" ]; then
      printf 'central 1.3.9 (independently-authored test metadata)\\n'
    elif [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/newer" ]; then
      printf 'central 1.7.0 (independently-authored test metadata)\\n'
    else
      printf 'central 1.6.2 (independently-authored test metadata)\\n'
    fi
    ;;
  status)
    while [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/status-wait" ]; do sleep 0.01; done
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/signed-out" ]; then
      printf '\\033[1mAuth      \\033[m \\033[1mnot connected\\033[m\\n'
    else
      printf '\\033[1mAuth      \\033[m \\033[1mSynthetic Access\\033[m\\n'
    fi
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-stopped" ]; then
      printf '\\033[1mProxy     \\033[m \\033[1mstopped\\033[m\\n'
    else
      printf '\\033[1mProxy     \\033[m \\033[1mrunning on port 19516\\033[m\\n'
    fi
    printf 'synthetic-sensitive-child-output\\n'
    ;;
  quota)
    [ "$2" = "--json" ]
    quota_alt=0
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/quota-alt" ]; then quota_alt=1; fi
    while [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/quota-wait" ]; do sleep 0.01; done
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/quota-fail" ]; then
      printf 'synthetic-sensitive-quota-error\\n' >&2
      exit 9
    fi
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/quota-invalid" ]; then
      printf '{"diagnostic":"synthetic-sensitive-quota-output"}\\n'
    elif [ "$quota_alt" = "1" ]; then
      printf '{"email":"hidden@example.test","tariffQuota":{"available":"18.50","maximum":"20.00"},"topUpQuota":{"available":"99.00"},"diagnostic":"synthetic-sensitive-quota-output"}\\n'
    else
      printf '{"email":"hidden@example.test","tariffQuota":{"available":"19.92","maximum":"20.00"},"topUpQuota":{"available":"99.00"},"diagnostic":"synthetic-sensitive-quota-output"}\\n'
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
    rm -f "$THINKRAIL_CENTRAL_TEST_CONTROL/outdated"
    ;;
  proxy)
    if [ "$2" = "stop" ]; then
      if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-stop-fail" ]; then exit 9; fi
      exit 0
    fi
    [ "$2" = "start" ]
    [ "$3" = "--ensure-updated" ]
    if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-start-fail" ]; then exit 9; fi
    while [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-start-wait" ]; do sleep 0.01; done
    if [ ! -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-stays-stopped" ]; then
      rm -f "$THINKRAIL_CENTRAL_TEST_CONTROL/proxy-stopped"
    fi
    ;;
  login)
    if [ "\${2:-}" = "export" ]; then
      if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/access-current-alumni" ]; then
        org=aaa; workspace=bbb
      else
        org=ccc; workspace=ddd
      fi
      printf 'central-'
      printf '{"version":1,"environment":"prod","refresh_token":"synthetic-refresh-secret","ai_access":{"type":"workspace","org_id":"%s","workspace_id":"%s"}}' "$org" "$workspace" | base64 | tr -d '\\n='
      printf '\\n'
    fi
    ;;
  access)
      if [ -f "$THINKRAIL_CENTRAL_TEST_CONTROL/access-switch-fail" ]; then
        printf 'synthetic-sensitive-child-output\n' >&2
        exit 9
      fi
      if [ "$2" = "workspace:aaa:bbb" ]; then
        touch "$THINKRAIL_CENTRAL_TEST_CONTROL/access-current-alumni"
      else
        rm -f "$THINKRAIL_CENTRAL_TEST_CONTROL/access-current-alumni"
      fi
      printf 'AI access source switched to %s\n' "$2"
    ;;
  *)
    exit 8
    ;;
esac
`;

let root: string;
let home: string;
let agentDir: string;
let controlDir: string;
let logPath: string;
let extensionSource: string;
let artifactPath: string;
let priorEnv: Record<string, string | undefined>;
let restoreAccessFetch: (() => void) | undefined;

function mockCentralAccessRequests(): void {
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
				if (String(input) === "https://oauth.account.jetbrains.com/oauth2/token") {
					expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe(
						"synthetic-refresh-secret",
					);
					return Response.json({ access_token: "synthetic-access-secret" });
				}
				expect(String(input)).toBe(
					"https://api.jetbrains.cloud/user-management/api/ai-access-options",
				);
				expect(new Headers(init?.headers).get("Authorization")).toBe(
					"Bearer synthetic-access-secret",
				);
				return Response.json({
					aiAccessOptions: [
						{
							type: "workspace",
							orgId: "aaa",
							workspaceId: "bbb",
							workspaceName: "JB Alumni",
							aiAccessEnabled: true,
						},
						{
							type: "workspace",
							orgId: "ccc",
							workspaceId: "ddd",
							workspaceName: "JetBrains Team",
							aiAccessEnabled: true,
						},
					],
				});
			},
			{ preconnect: globalThis.fetch.preconnect },
		),
	);
	restoreAccessFetch = () => fetchSpy.mockRestore();
}

function control(name: string, present: boolean): void {
	const path = join(controlDir, name);
	if (present) writeFileSync(path, "1\n");
	else rmSync(path, { force: true });
}

function probeCount(): number {
	return commandLog().filter((invocation) => invocation === "status").length;
}

function commandLog(): string[] {
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
}

async function pollStatus(state: string): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if ((await getJbcentralStatus()).state === state) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Central status did not reach ${state}`);
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("condition was not reached");
}

async function initializeConnectedCentralFixture(): Promise<void> {
	await resetJbcentralStateForTests();
	configurePiRuntime(null);
	mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
	writeFileSync(artifactPath, syntheticExtension("central-model"));
	await initializeJbcentralRuntime();
	expect((await getJbcentralStatus()).state).toBe("configured");
}

async function emptyRuntime(): Promise<ModelRuntime> {
	return ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
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
	writeFileSync(extensionSource, syntheticExtension("central-model"));
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
	restoreAccessFetch?.();
	restoreAccessFetch = undefined;
	disposeAllSessions();
	await resetJbcentralStateForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	for (const [name, value] of Object.entries(priorEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

describe("watched native Central runtime", () => {
	test("connect loads the global opaque artifact with a custom PI agent dir", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(existsSync(artifactPath)).toBe(true);
		expect((await getJbcentralStatus()).state).toBe("configured");
		expect((await listAvailableModels()).map((model) => model.id)).toContain("central-model");
		const report = await getProviderStatus();
		const anthropic = report.providers.find((provider) => provider.id === "anthropic");
		expect(anthropic).toBeDefined();
		if (!anthropic) throw new Error("synthetic Central anthropic provider missing");
		expect(anthropic).toMatchObject({ id: "anthropic", configured: true, kind: "central" });
		expect(anthropic.name).not.toBe("synthetic-sensitive-provider-name");
		expect(anthropic.detail).toBeUndefined();
		expect(anthropic.canLogout).toBeUndefined();
		expect(JSON.stringify(report)).not.toContain("synthetic-central.invalid");
		expect(JSON.stringify(report)).not.toContain("synthetic-proxy-key");
		expect(JSON.stringify(report)).not.toContain("synthetic-sensitive-provider-name");
		expect(report.providers.map((provider) => provider.id)).not.toContain("central-test");
		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		const disconnectedAnthropic = (await getProviderStatus()).providers.find(
			(provider) => provider.id === "anthropic",
		);
		expect(disconnectedAnthropic).toBeDefined();
		expect(disconnectedAnthropic?.kind).not.toBe("central");
		expect(commandLog()).toContain("add pi");
	});

	test("quota is hidden until Central is healthy, then exposes only recurring numbers", async () => {
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toEqual({ state: "hidden" });
		expect(commandLog()).not.toContain("quota --json");

		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		const quota = await getJbcentralQuota({ maxAgeMs: 30_000 });
		expect(quota).toMatchObject({ state: "available", remaining: 19.92, total: 20 });
		expect(quota).toHaveProperty("observedAt");
		expect(commandLog().filter((line) => line === "quota --json")).toHaveLength(1);
		expect(JSON.stringify(quota)).not.toContain("hidden@example.test");
		expect(JSON.stringify(quota)).not.toContain("synthetic-sensitive-quota-output");
	});

	test("quota cache and single-flight deduplicate readers while force refreshes", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("quota-wait", true);
		const first = getJbcentralQuota({ maxAgeMs: 30_000 });
		const second = getJbcentralQuota({ maxAgeMs: 30_000 });
		await waitFor(() => commandLog().includes("quota --json"));
		control("quota-wait", false);
		const [firstResult, secondResult] = await Promise.all([first, second]);
		expect(firstResult).toEqual(secondResult);
		expect(commandLog().filter((line) => line === "quota --json")).toHaveLength(1);

		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toEqual(firstResult);
		expect(commandLog().filter((line) => line === "quota --json")).toHaveLength(1);
		control("quota-alt", true);
		expect(await getJbcentralQuota({ maxAgeMs: 30_000, force: true })).toMatchObject({
			state: "available",
			remaining: 18.5,
			total: 20,
		});
		expect(commandLog().filter((line) => line === "quota --json")).toHaveLength(2);
	});

	test("quota failure is unavailable before success and stale afterward", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("quota-fail", true);
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toEqual({ state: "unavailable" });
		control("quota-fail", false);
		const available = await getJbcentralQuota({ maxAgeMs: 30_000, force: true });
		expect(available).toMatchObject({ state: "available", remaining: 19.92, total: 20 });
		if (available.state !== "available") throw new Error("quota did not become available");

		control("quota-invalid", true);
		expect(await getJbcentralQuota({ maxAgeMs: 30_000, force: true })).toEqual({
			state: "stale",
			remaining: 19.92,
			total: 20,
			observedAt: available.observedAt,
		});
	});

	test("signed-out and stopped-proxy states hide quota without invoking it", async () => {
		const realNow = Date.now;
		let skew = 0;
		const clock = spyOn(Date, "now").mockImplementation(() => realNow() + skew);
		try {
			expect(await connectJbcentral()).toEqual({ outcome: "applied" });
			control("signed-out", true);
			skew += JBCENTRAL_STATUS_TTL_MS;
			await waitFor(async () => {
				const status = await getJbcentralStatus();
				return status.state === "configured" && status.signedOut;
			});
			const beforeSignedOut = commandLog().filter((line) => line === "quota --json").length;
			expect(await getJbcentralQuota({ maxAgeMs: 0, force: true })).toEqual({ state: "hidden" });
			expect(commandLog().filter((line) => line === "quota --json")).toHaveLength(beforeSignedOut);

			control("signed-out", false);
			control("proxy-stopped", true);
			skew += JBCENTRAL_STATUS_TTL_MS;
			await waitFor(async () => {
				const status = await getJbcentralStatus();
				return status.state === "configured" && status.proxyStopped;
			});
			const beforeStopped = commandLog().filter((line) => line === "quota --json").length;
			expect(await getJbcentralQuota({ maxAgeMs: 0, force: true })).toEqual({ state: "hidden" });
			expect(commandLog().filter((line) => line === "quota --json")).toHaveLength(beforeStopped);
		} finally {
			clock.mockRestore();
		}
	});

	test("disconnect invalidates quota freshness before a later reconnect", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toMatchObject({ remaining: 19.92 });
		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toEqual({ state: "hidden" });
		control("quota-alt", true);
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toMatchObject({
			state: "available",
			remaining: 18.5,
		});
		expect(commandLog().filter((line) => line === "quota --json")).toHaveLength(2);
	});

	test("a post-lifecycle read never joins an in-flight quota from the previous generation", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("quota-wait", true);
		const oldRead = getJbcentralQuota({ maxAgeMs: 30_000 });
		await waitFor(() => commandLog().includes("quota --json"));
		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		control("quota-alt", true);
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		const versionReads = commandLog().filter((line) => line === "--version").length;
		const newRead = getJbcentralQuota({ maxAgeMs: 30_000 });
		await waitFor(() => commandLog().filter((line) => line === "--version").length > versionReads);
		await new Promise((resolve) => setTimeout(resolve, 20));
		control("quota-wait", false);

		expect(await oldRead).toMatchObject({ state: "available", remaining: 19.92 });
		expect(await newRead).toMatchObject({ state: "available", remaining: 18.5 });
		expect(commandLog().filter((line) => line === "quota --json")).toHaveLength(2);
	});

	test("a Central lifecycle change prevents an old account balance becoming stale fallback", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toMatchObject({
			state: "available",
			remaining: 19.92,
		});
		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		control("quota-fail", true);
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toEqual({ state: "unavailable" });
	});

	test("lists AI access sources with a switch id only once Central is connected", async () => {
		mockCentralAccessRequests();
		expect(await getJbcentralAccessSources()).toEqual({ outcome: "failed" });
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralAccessSources()).toEqual({
			outcome: "succeeded",
			sources: [
				{
					displayName: "JB Alumni",
					kind: "workspace",
					current: false,
					selectionId: "workspace:aaa:bbb",
				},
				{
					displayName: "JetBrains Team",
					kind: "workspace",
					current: true,
					selectionId: "workspace:ccc:ddd",
				},
			],
		});
	});

	test("switches the access source, restarts the proxy, and invalidates the cached quota", async () => {
		mockCentralAccessRequests();
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toMatchObject({
			state: "available",
			remaining: 19.92,
		});

		expect(await switchJbcentralAccess("workspace:aaa:bbb")).toEqual({
			outcome: "succeeded",
			proxyRestarted: true,
		});
		expect(commandLog()).toContain("access workspace:aaa:bbb");
		expect(commandLog()).toContain("proxy stop");
		expect(commandLog()).toContain("proxy start --ensure-updated");

		const sources = await getJbcentralAccessSources();
		expect(sources).toMatchObject({
			outcome: "succeeded",
			sources: [
				{ displayName: "JB Alumni", current: true },
				{ displayName: "JetBrains Team", current: false },
			],
		});

		control("quota-alt", true);
		expect(await getJbcentralQuota({ maxAgeMs: 30_000 })).toMatchObject({
			state: "available",
			remaining: 18.5,
		});
	});

	test("a failed switch never restarts the proxy and reports a closed failure", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("access-switch-fail", true);

		const result = await switchJbcentralAccess("workspace:aaa:bbb");
		expect(result).toEqual({ outcome: "failed" });
		expect(commandLog()).not.toContain("proxy stop");
	});

	test("a switch that cannot restart the proxy still reports the switch itself as succeeded", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("proxy-stop-fail", true);

		expect(await switchJbcentralAccess("workspace:aaa:bbb")).toEqual({
			outcome: "succeeded",
			proxyRestarted: false,
		});
	});

	test("duplicate requests for the latest source share one switch", async () => {
		await initializeConnectedCentralFixture();
		const first = switchJbcentralAccess("workspace:aaa:bbb");
		const second = switchJbcentralAccess("workspace:aaa:bbb");
		expect(first).toBe(second);
		expect(await first).toEqual({ outcome: "succeeded", proxyRestarted: true });
		expect(commandLog().filter((line) => line === "access workspace:aaa:bbb")).toHaveLength(1);
	});

	test("distinct sources wait for the earlier switch and proxy restart", async () => {
		mockCentralAccessRequests();
		await initializeConnectedCentralFixture();
		control("proxy-start-wait", true);
		const first = switchJbcentralAccess("workspace:aaa:bbb");
		await waitFor(() => commandLog().includes("proxy start --ensure-updated"));
		const second = switchJbcentralAccess("workspace:ccc:ddd");
		expect(second).not.toBe(first);
		expect(switchJbcentralAccess("workspace:ccc:ddd")).toBe(second);
		expect(commandLog()).not.toContain("access workspace:ccc:ddd");
		control("proxy-start-wait", false);
		expect(await first).toEqual({ outcome: "succeeded", proxyRestarted: true });
		expect(await second).toEqual({ outcome: "succeeded", proxyRestarted: true });
		expect(
			commandLog().filter((line) => line.startsWith("access ") || line.startsWith("proxy ")),
		).toEqual([
			"access workspace:aaa:bbb",
			"proxy stop",
			"proxy start --ensure-updated",
			"access workspace:ccc:ddd",
			"proxy stop",
			"proxy start --ensure-updated",
		]);
		expect(await getJbcentralAccessSources()).toMatchObject({
			outcome: "succeeded",
			sources: [{ current: false }, { current: true }],
		});
	});

	test("a switch back after a different queued source is not deduplicated", async () => {
		mockCentralAccessRequests();
		await initializeConnectedCentralFixture();
		const first = switchJbcentralAccess("workspace:aaa:bbb");
		const second = switchJbcentralAccess("workspace:ccc:ddd");
		const third = switchJbcentralAccess("workspace:aaa:bbb");
		expect(third).not.toBe(first);
		expect(third).not.toBe(second);
		expect(switchJbcentralAccess("workspace:aaa:bbb")).toBe(third);
		expect(await Promise.all([first, second, third])).toEqual([
			{ outcome: "succeeded", proxyRestarted: true },
			{ outcome: "succeeded", proxyRestarted: true },
			{ outcome: "succeeded", proxyRestarted: true },
		]);
		expect(commandLog().filter((line) => line.startsWith("access "))).toEqual([
			"access workspace:aaa:bbb",
			"access workspace:ccc:ddd",
			"access workspace:aaa:bbb",
		]);
		expect(await getJbcentralAccessSources()).toMatchObject({
			outcome: "succeeded",
			sources: [{ current: true }, { current: false }],
		});
	});

	test("disconnect affects new work while an existing Central chat keeps its generation", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		const centralModel = (await listAvailableModels()).find(
			(model) => model.id === "central-model",
		);
		if (!centralModel) throw new Error("synthetic Central model missing");
		const session = await createSession({
			cwd: root,
			workspaceId: "workspace-existing",
			model: centralModel,
		});

		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		expect((await getJbcentralStatus()).state).toBe("supported");
		expect((await listAvailableModels()).map((model) => model.id)).not.toContain("central-model");
		const hydrated = await getSessionMessages(session.sessionId, "workspace-existing", root);
		expect(hydrated.summary.model).toMatchObject({
			provider: "central-test",
			id: "central-model",
		});
	});

	test("watches external add, replacement, and remove", async () => {
		mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
		writeFileSync(artifactPath, syntheticExtension("external-one"));
		await pollStatus("configured");
		expect((await listAvailableModels()).map((model) => model.id)).toContain("external-one");

		writeFileSync(artifactPath, syntheticExtension("external-two"));
		await waitFor(async () =>
			(await listAvailableModels()).some((model) => model.id === "external-two"),
		);
		expect((await listAvailableModels()).map((model) => model.id)).not.toContain("external-one");

		rmSync(artifactPath);
		await pollStatus("supported");
		expect((await listAvailableModels()).map((model) => model.id)).not.toContain("external-two");
	});

	test("rejects a stale candidate when the watched artifact changes again", async () => {
		const stale = await emptyRuntime();
		const newest = await emptyRuntime();
		let releaseFirst: (() => void) | undefined;
		const firstRelease = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let reportFirst: (() => void) | undefined;
		const firstStarted = new Promise<void>((resolve) => {
			reportFirst = resolve;
		});
		let calls = 0;
		configurePiRuntimeFactory(async () => {
			calls += 1;
			if (calls === 1) {
				reportFirst?.();
				await firstRelease;
				return stale;
			}
			return newest;
		});

		mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
		writeFileSync(artifactPath, syntheticExtension("stale"));
		await firstStarted;
		expect((await getJbcentralStatus()).state).toBe("configuring");
		writeFileSync(artifactPath, syntheticExtension("newest"));
		releaseFirst?.();
		await waitFor(() => usePiRuntime((runtime) => runtime === newest));
		expect((await getJbcentralStatus()).state).toBe("configured");
		expect(await usePiRuntime((runtime) => runtime === stale)).toBe(false);
	});

	test("retains the current runtime on candidate failure and Disconnect repairs it", async () => {
		const current = await usePiRuntime((runtime) => runtime);
		configurePiRuntimeFactory(async () => {
			throw new Error("synthetic-private-loader-diagnostic");
		});
		mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
		writeFileSync(artifactPath, syntheticExtension("broken-candidate"));
		await pollStatus("load-failed");
		expect(await usePiRuntime((runtime) => runtime === current)).toBe(true);
		expect(await getJbcentralStatus()).toEqual({
			state: "load-failed",
			configured: true,
			reason: "candidate-failed",
		});

		configurePiRuntimeFactory();
		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		expect((await getJbcentralStatus()).state).toBe("supported");
	});

	test("retries a failed plain candidate after Central itself disappears", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		configurePiRuntimeFactory(async () => {
			throw new Error("synthetic-private-plain-runtime-diagnostic");
		});
		expect(await disconnectJbcentral()).toEqual({
			outcome: "failed",
			reason: "candidate-failed",
		});
		await pollStatus("load-failed");
		expect(await getJbcentralStatus()).toMatchObject({
			state: "load-failed",
			configured: false,
		});

		configurePiRuntimeFactory();
		process.env.PATH = "";
		expect(await disconnectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralStatus()).toEqual({ state: "absent" });
	});

	test("falls back to a plain runtime when the configured extension fails at boot", async () => {
		await resetJbcentralStateForTests();
		configurePiRuntime(null);
		mkdirSync(join(home, ".pi", "agent", "extensions"), { recursive: true });
		writeFileSync(artifactPath, "this is not valid TypeScript {{{");

		await initializeJbcentralRuntime();
		expect(await getJbcentralStatus()).toMatchObject({
			state: "load-failed",
			configured: true,
			reason: "candidate-failed",
		});
		expect(Array.isArray(await listAvailableModels())).toBe(true);
	});

	test("single-flights in-app actions and publishes closed invalidations", async () => {
		control("add-wait", true);
		let invalidations = 0;
		setJbcentralChangedPublisher(() => {
			invalidations += 1;
		});
		const first = connectJbcentral();
		const second = connectJbcentral();
		expect(first).toBe(second);
		await waitFor(() => commandLog().includes("add pi"));
		control("add-wait", false);
		expect(await first).toEqual({ outcome: "applied" });
		expect(commandLog().filter((line) => line === "add pi")).toHaveLength(1);
		expect(invalidations).toBeGreaterThan(0);
	});

	test("regenerates an existing artifact after updating Central", async () => {
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("outdated", true);
		expect(await updateJbcentral()).toEqual({ outcome: "applied" });
		const actions = commandLog().filter((invocation) => invocation !== "--version");
		expect(actions.slice(-2)).toEqual(["update --install", "add pi"]);
		expect((await getJbcentralStatus()).state).toBe("configured");
	});

	test("reports a signed-out Central off the read path, without exposing the probe's output", async () => {
		control("signed-out", true);
		expect(await getJbcentralStatus()).toEqual({
			state: "supported",
			version: "1.6.2",
			signedOut: false,
		});
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "supported" && status.signedOut;
		});
		expect(commandLog()).toContain("status");
		expect(JSON.stringify(await getJbcentralStatus())).not.toContain(
			"synthetic-sensitive-child-output",
		);

		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect(await getJbcentralStatus()).toEqual({
			state: "configured",
			version: "1.6.2",
			signedOut: true,
			proxyStopped: false,
		});
	});

	test("reports and starts a positively stopped proxy without rebuilding the runtime", async () => {
		control("proxy-stopped", true);
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "configured" && status.proxyStopped;
		});
		const runtime = await usePiRuntime((current) => current);

		expect(await startProxyJbcentral()).toEqual({ outcome: "applied" });
		expect(commandLog()).toContain("proxy start --ensure-updated");
		expect(await getJbcentralStatus()).toEqual({
			state: "configured",
			version: "1.6.2",
			signedOut: false,
			proxyStopped: false,
		});
		expect(await usePiRuntime((current) => current === runtime)).toBe(true);
	});

	test("keeps Start proxy single-flighted and closed when the proxy remains stopped", async () => {
		control("proxy-stopped", true);
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		control("proxy-start-wait", true);
		control("proxy-stays-stopped", true);
		const first = startProxyJbcentral();
		const second = startProxyJbcentral();
		expect(first).toBe(second);
		await waitFor(() => commandLog().includes("proxy start --ensure-updated"));
		control("proxy-start-wait", false);
		expect(await first).toEqual({ outcome: "failed", reason: "central-action-failed" });
		expect(commandLog().filter((line) => line === "proxy start --ensure-updated")).toHaveLength(1);
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "configured" && status.proxyStopped;
		});
	});

	test("collapses a burst of status reads into a single status probe", async () => {
		await getJbcentralStatus();
		await waitFor(() => probeCount() >= 1);
		const settled = probeCount();
		for (let read = 0; read < 6; read += 1) await getJbcentralStatus();
		expect(probeCount()).toBe(settled);
	});

	test("never probes Central status while an action or rebuild is in flight", async () => {
		await getJbcentralStatus();
		await waitFor(() => probeCount() >= 1);
		expect(await jbcentralLogin()).toEqual({ outcome: "launched" });

		control("add-wait", true);
		const connect = connectJbcentral();
		await waitFor(() => commandLog().includes("add pi"));
		const duringAction = probeCount();
		for (let poll = 0; poll < 6; poll += 1) {
			expect((await getJbcentralStatus()).state).toBe("configuring");
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		expect(probeCount()).toBe(duringAction);

		control("add-wait", false);
		expect(await connect).toEqual({ outcome: "applied" });
		await waitFor(async () => {
			await getJbcentralStatus();
			return probeCount() > duringAction;
		});
	});

	test("an invalidation that overtakes an in-flight probe discards its answer", async () => {
		control("status-wait", true);
		control("signed-out", true);
		await getJbcentralStatus();
		await waitFor(() => probeCount() >= 1);

		control("signed-out", false);
		expect(await jbcentralLogin()).toEqual({ outcome: "launched" });
		control("status-wait", false);

		const started = Date.now();
		let reprobed = false;
		while (Date.now() - started < 1_500) {
			await getJbcentralStatus();
			if (probeCount() >= 2) {
				reprobed = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(reprobed).toBe(true);
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "supported" && !status.signedOut;
		});
	});

	test("launching sign-in invalidates the cached verdict so the next read re-probes", async () => {
		control("signed-out", true);
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "supported" && status.signedOut;
		});
		const probes = probeCount();

		control("signed-out", false);
		expect(await jbcentralLogin()).toEqual({ outcome: "launched" });
		await waitFor(async () => {
			const status = await getJbcentralStatus();
			return status.state === "supported" && !status.signedOut;
		});
		expect(probeCount()).toBeGreaterThan(probes);
	});

	test("treats a version above the minimum as supported", async () => {
		control("newer", true);
		expect((await getJbcentralStatus()).state).toBe("supported");
		expect(await connectJbcentral()).toEqual({ outcome: "applied" });
		expect((await getJbcentralStatus()).state).toBe("configured");
	});

	test("keeps version/login/update outcomes closed", async () => {
		control("malformed", true);
		expect(await jbcentralLogin()).toEqual({ outcome: "failed", reason: "unsupported-version" });
		expect(await updateJbcentral()).toEqual({ outcome: "failed", reason: "unsupported-version" });
		control("malformed", false);
		control("outdated", true);
		expect(await updateJbcentral()).toEqual({ outcome: "applied" });
		expect(commandLog()).toContain("update --install");

		control("add-fail", true);
		const failed = await connectJbcentral();
		expect(failed).toEqual({ outcome: "failed", reason: "central-action-failed" });
		expect(JSON.stringify(failed)).not.toContain("synthetic-sensitive-child-output");
	});
});
