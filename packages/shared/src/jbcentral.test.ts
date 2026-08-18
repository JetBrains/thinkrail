import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lock } from "proper-lockfile";
import {
	cleanupLegacyJbcentralModels,
	inspectJbcentral,
	isJbcentralInstalled,
	type JbcentralAdapterDependencies,
	jbcentralExtensionPath,
	jbcentralInstall,
	jbcentralModelsPath,
	launchJbcentralLogin,
	parseJbcentralVersion,
	REVIEWED_CENTRAL_VERSION,
	resolveJbcentralBin,
	rollbackLegacyJbcentralCleanup,
	runJbcentralAction,
} from "./jbcentral";

const CENTRAL_BIN = "/opt/central/bin/central";

function adapterDeps(overrides: JbcentralAdapterDependencies = {}): JbcentralAdapterDependencies {
	return {
		env: { HOME: "/users/test", PATH: "/opt/central/bin" },
		which: () => CENTRAL_BIN,
		exists: () => false,
		...overrides,
	};
}

describe("Central version inspection", () => {
	test("parses the reviewed public version prefix without retaining build metadata", () => {
		expect(parseJbcentralVersion("central 1.6.2 (test build metadata)\n")).toEqual({
			major: 1,
			minor: 6,
			patch: 2,
			text: "1.6.2",
		});
		expect(parseJbcentralVersion("1.6.2")).toBeNull();
		expect(parseJbcentralVersion("central 1.6")).toBeNull();
		expect(parseJbcentralVersion("prefix central 1.6.2")).toBeNull();
	});

	test("accepts exactly the reviewed version and reports artifact presence", async () => {
		const requests: string[][] = [];
		const extensionPath = "/users/test/.pi/agent/extensions/jetbrains-central.ts";
		const deps = adapterDeps({
			exists: (path) => path === extensionPath,
			run: async (request) => {
				requests.push([...request.argv]);
				return {
					outcome: "exited",
					exitCode: 0,
					stdout: `central ${REVIEWED_CENTRAL_VERSION} (synthetic metadata)`,
				};
			},
		});
		expect(await inspectJbcentral(deps)).toEqual({
			executablePath: CENTRAL_BIN,
			extensionPath,
			status: { state: "supported", version: "1.6.2", configured: true },
		});
		expect(requests).toEqual([[CENTRAL_BIN, "--version"]]);
	});

	test("classifies older, newer, malformed, absent, and failed probes without raw output", async () => {
		async function inspectOutput(stdout: string, exitCode = 0) {
			return inspectJbcentral(
				adapterDeps({
					run: async () => ({ outcome: "exited", exitCode, stdout }),
				}),
			);
		}

		expect((await inspectOutput("central 1.6.1 (synthetic)")).status).toEqual({
			state: "outdated",
			version: "1.6.1",
		});
		expect((await inspectOutput("central 1.6.3 (synthetic)")).status).toEqual({
			state: "unreviewed",
			version: "1.6.3",
		});
		const secretOutput = "synthetic-sensitive-version-output";
		const malformed = await inspectOutput(secretOutput);
		expect(malformed.status).toEqual({ state: "malformed-version" });
		expect(JSON.stringify(malformed)).not.toContain(secretOutput);
		expect((await inspectOutput(secretOutput, 2)).status).toEqual({
			state: "probe-failed",
			reason: "nonzero-exit",
		});
		expect(await inspectJbcentral(adapterDeps({ which: () => null, exists: () => false }))).toEqual(
			{
				executablePath: null,
				extensionPath: "/users/test/.pi/agent/extensions/jetbrains-central.ts",
				status: { state: "absent" },
			},
		);
		expect(
			(await inspectJbcentral(adapterDeps({ run: async () => ({ outcome: "timed-out" }) }))).status,
		).toEqual({ state: "probe-failed", reason: "timed-out" });
		expect(
			(
				await inspectJbcentral(
					adapterDeps({
						run: async () => {
							throw new Error(secretOutput);
						},
					}),
				)
			).status,
		).toEqual({ state: "probe-failed", reason: "launch-failed" });
	});
});

describe("Central command adapter", () => {
	test("runs only reviewed action argv through the absolute executable", async () => {
		const requests: Array<{
			argv: readonly string[];
			captureStdout: boolean;
			timeoutMs: number;
		}> = [];
		let artifactExists = false;
		const deps = adapterDeps({
			exists: (path) =>
				path === "/users/test/.pi/agent/extensions/jetbrains-central.ts" && artifactExists,
			run: async (request) => {
				requests.push({
					argv: request.argv,
					captureStdout: request.captureStdout,
					timeoutMs: request.timeoutMs,
				});
				if (request.argv[1] === "add") artifactExists = true;
				if (request.argv[1] === "remove") artifactExists = false;
				return { outcome: "exited", exitCode: 0, stdout: "discarded synthetic output" };
			},
		});

		expect(await runJbcentralAction("add", deps)).toEqual({ outcome: "succeeded" });
		expect(await runJbcentralAction("remove", deps)).toEqual({ outcome: "succeeded" });
		expect(await runJbcentralAction("update", deps)).toEqual({ outcome: "succeeded" });
		expect(requests.map(({ argv }) => argv)).toEqual([
			[CENTRAL_BIN, "add", "pi"],
			[CENTRAL_BIN, "remove", "pi"],
			[CENTRAL_BIN, "update", "--install"],
		]);
		expect(requests.every(({ captureStdout }) => !captureStdout)).toBe(true);
		expect(requests[2]?.timeoutMs).toBeGreaterThan(requests[0]?.timeoutMs ?? 0);
	});

	test("enforces add/remove artifact postconditions", async () => {
		const run = async () => ({ outcome: "exited" as const, exitCode: 0, stdout: "" });
		expect(await runJbcentralAction("add", adapterDeps({ exists: () => false, run }))).toEqual({
			outcome: "failed",
			reason: "artifact-missing",
		});
		expect(await runJbcentralAction("remove", adapterDeps({ exists: () => true, run }))).toEqual({
			outcome: "failed",
			reason: "artifact-present",
		});
	});

	test("returns closed generic process failures and discards raw command output", async () => {
		const rawOutput = "synthetic-private-child-output";
		const result = await runJbcentralAction(
			"add",
			adapterDeps({
				run: async () => ({ outcome: "exited", exitCode: 7, stdout: rawOutput }),
			}),
		);
		expect(result).toEqual({ outcome: "failed", reason: "nonzero-exit" });
		expect(JSON.stringify(result)).not.toContain(rawOutput);
		expect(
			await runJbcentralAction("add", adapterDeps({ which: () => null, exists: () => false })),
		).toEqual({ outcome: "failed", reason: "not-installed" });
		expect(
			await runJbcentralAction(
				"add",
				adapterDeps({
					run: async () => {
						throw new Error(rawOutput);
					},
				}),
			),
		).toEqual({ outcome: "failed", reason: "launch-failed" });
	});

	test("launches login detached with approved argv and a generic result", () => {
		let argv: readonly string[] = [];
		expect(
			launchJbcentralLogin(
				adapterDeps({
					launchDetached: (nextArgv) => {
						argv = nextArgv;
						return true;
					},
				}),
			),
		).toEqual({ outcome: "launched" });
		expect(argv).toEqual([CENTRAL_BIN, "login"]);
		expect(
			launchJbcentralLogin(
				adapterDeps({
					launchDetached: () => {
						throw new Error("synthetic-private-login-error");
					},
				}),
			),
		).toEqual({ outcome: "failed", reason: "launch-failed" });
	});
});

describe("Central paths and install guidance", () => {
	const originalPath = process.env.PATH;
	const originalHome = process.env.HOME;
	let tempHome: string | undefined;

	afterEach(() => {
		process.env.PATH = originalPath;
		process.env.HOME = originalHome;
		if (tempHome) rmSync(tempHome, { recursive: true, force: true });
		tempHome = undefined;
	});

	test("finds the installer fallback and ignores the legacy binary name", () => {
		tempHome = mkdtempSync(join(tmpdir(), "central-home-"));
		const binDir = join(tempHome, ".local", "bin");
		mkdirSync(binDir, { recursive: true });
		const central = join(binDir, "central");
		writeFileSync(central, "#!/bin/sh\n");
		chmodSync(central, 0o755);

		const deps = { env: { HOME: tempHome, PATH: "" }, which: () => null };
		expect(resolveJbcentralBin(deps)).toBe(central);
		expect(isJbcentralInstalled(deps)).toBe(true);
		rmSync(central);
		writeFileSync(join(binDir, "jbcentral"), "#!/bin/sh\n");
		expect(resolveJbcentralBin(deps)).toBeNull();
	});

	test("rejects a relative PATH result", () => {
		expect(
			resolveJbcentralBin(adapterDeps({ which: () => "central", exists: () => false })),
		).toBeNull();
	});

	test("uses the global extension even with a custom PI agent directory", () => {
		const env = { HOME: "/home/person", PI_CODING_AGENT_DIR: "/tmp/custom-agent" };
		expect(jbcentralExtensionPath(env)).toBe(
			"/home/person/.pi/agent/extensions/jetbrains-central.ts",
		);
		expect(jbcentralModelsPath(env)).toBe("/tmp/custom-agent/models.json");
	});

	test("returns official per-OS install plans", () => {
		const base = "https://jetbrains-central-cli.s3.eu-west-1.amazonaws.com/central/stable";
		expect(jbcentralInstall("darwin")).toEqual({
			platform: "darwin",
			shell: "bash",
			command: `curl -fsSL ${base}/install.sh | bash`,
		});
		expect(jbcentralInstall("win32")).toEqual({
			platform: "win32",
			shell: "powershell",
			command: `irm ${base}/install.ps1 | iex`,
		});
	});
});

describe("legacy models cleanup", () => {
	let root: string;
	let agentDir: string;
	let modelsPath: string;
	let backupPath: string;

	function env() {
		return { HOME: root, PI_CODING_AGENT_DIR: agentDir };
	}

	function writeModels(value: unknown, mode = 0o640) {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(modelsPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
		chmodSync(modelsPath, mode);
	}

	function readModels(): Record<string, unknown> {
		return JSON.parse(readFileSync(modelsPath, "utf8")) as Record<string, unknown>;
	}

	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true });
	});

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "central-models-"));
		agentDir = join(root, "custom-agent");
		modelsPath = join(agentDir, "models.json");
		backupPath = `${modelsPath}.bak`;
	});

	test("removes only exact paired legacy fields and preserves unrelated data, backup, and mode", async () => {
		writeModels({
			customTopLevel: { keep: true },
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/test-token/pi/anthropic",
					apiKey: "wire-proxy",
					models: [{ id: "keep-model" }],
				},
				openai: {
					baseUrl: "http://127.0.0.1:0/wire/another-token/pi/openai/v1",
					apiKey: "wire-proxy",
				},
				custom: { baseUrl: "https://example.test", apiKey: "keep-key" },
			},
		});
		writeFileSync(backupPath, "original backup bytes\n", { mode: 0o600 });

		const result = await cleanupLegacyJbcentralModels({ env: env() });
		expect(result.outcome).toBe("cleaned");
		if (result.outcome !== "cleaned") throw new Error("expected cleanup receipt");
		expect(result.receipt.changedProviderCount).toBe(2);
		expect(JSON.stringify(result.receipt)).not.toContain("test-token");
		expect(readModels()).toEqual({
			customTopLevel: { keep: true },
			providers: {
				anthropic: { models: [{ id: "keep-model" }] },
				openai: {},
				custom: { baseUrl: "https://example.test", apiKey: "keep-key" },
			},
		});
		expect(readFileSync(backupPath, "utf8")).toBe("original backup bytes\n");
		expect(statSync(modelsPath).mode & 0o777).toBe(0o640);
		expect(readdirSync(agentDir).filter((name) => name.includes(".thinkrail-"))).toEqual([]);
	});

	test("requires the exact key and provider-specific complete URL grammar", async () => {
		const candidates = [
			{ baseUrl: "http://127.0.0.1:19516/wire/token/claude-code/anthropic", apiKey: "wire-proxy" },
			{ baseUrl: "http://localhost:19516/wire/token/pi/anthropic", apiKey: "wire-proxy" },
			{ baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic/", apiKey: "wire-proxy" },
			{ baseUrl: "http://127.0.0.1:65536/wire/token/pi/anthropic", apiKey: "wire-proxy" },
			{ baseUrl: "http://127.0.0.1:19516/wire/token/pi/openai/v1", apiKey: "wire-proxy" },
			{ baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic", apiKey: "user-key" },
			{ baseUrl: "https://api.anthropic.test", apiKey: "wire-proxy" },
		];
		for (const candidate of candidates) {
			writeModels({ providers: { anthropic: candidate } });
			const before = readFileSync(modelsPath, "utf8");
			expect(await cleanupLegacyJbcentralModels({ env: env() })).toEqual({
				outcome: "unchanged",
			});
			expect(readFileSync(modelsPath, "utf8")).toBe(before);
		}
	});

	test("retries a concurrent edit and preserves the latest unrelated fields", async () => {
		writeModels({
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
				},
			},
		});
		let hooks = 0;
		const result = await cleanupLegacyJbcentralModels({
			env: env(),
			beforeCommit: ({ operation }) => {
				if (operation !== "cleanup" || hooks > 0) return;
				hooks += 1;
				const current = readModels();
				current.concurrentWriter = { preserved: true };
				writeModels(current);
			},
		});
		expect(result.outcome).toBe("cleaned");
		expect(hooks).toBe(1);
		expect(readModels()).toEqual({
			providers: { anthropic: {} },
			concurrentWriter: { preserved: true },
		});
	});

	test("does not overwrite an uncoordinated writer that publishes after the target is claimed", async () => {
		writeModels({
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
				},
			},
		});
		const concurrentConfig = { providers: { custom: { baseUrl: "https://user.example" } } };
		let writes = 0;
		const result = await cleanupLegacyJbcentralModels({
			env: env(),
			afterTargetClaimed: () => {
				if (writes > 0) return;
				writes += 1;
				writeModels(concurrentConfig);
			},
		});
		expect(result).toEqual({ outcome: "unchanged" });
		expect(writes).toBe(1);
		expect(readModels()).toEqual(concurrentConfig);
		expect(existsSync(join(agentDir, ".models.json.thinkrail-claim"))).toBe(false);
	});

	test("recovers a claimed target before continuing an interrupted transaction", async () => {
		writeModels({
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
				},
			},
		});
		const claimPath = join(agentDir, ".models.json.thinkrail-claim");
		renameSync(modelsPath, claimPath);

		expect((await cleanupLegacyJbcentralModels({ env: env() })).outcome).toBe("cleaned");
		expect(readModels()).toEqual({ providers: { anthropic: {} } });
		expect(existsSync(claimPath)).toBe(false);
	});

	test("fails closed after repeated CAS conflicts without removing the legacy pair", async () => {
		writeModels({
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
				},
			},
		});
		let revision = 0;
		const result = await cleanupLegacyJbcentralModels({
			env: env(),
			beforeCommit: () => {
				const current = readModels();
				current.revision = revision += 1;
				writeModels(current);
			},
		});
		expect(result).toEqual({ outcome: "failed", reason: "conflict" });
		const providers = readModels().providers as Record<string, Record<string, unknown>>;
		expect(providers.anthropic?.apiKey).toBe("wire-proxy");
	});

	test("rolls back removed fields while preserving later unrelated edits", async () => {
		writeModels({
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
					keep: true,
				},
				openai: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/openai/v1",
					apiKey: "wire-proxy",
				},
			},
		});
		const cleanup = await cleanupLegacyJbcentralModels({ env: env() });
		if (cleanup.outcome !== "cleaned") throw new Error("expected cleanup receipt");
		const current = readModels();
		current.afterCleanup = "keep";
		writeModels(current);

		expect(await rollbackLegacyJbcentralCleanup(cleanup.receipt)).toEqual({
			outcome: "rolled-back",
			restoredProviderCount: 2,
		});
		expect(readModels()).toEqual({
			providers: {
				anthropic: {
					keep: true,
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
				},
				openai: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/openai/v1",
					apiKey: "wire-proxy",
				},
			},
			afterCleanup: "keep",
		});
		expect(await rollbackLegacyJbcentralCleanup(cleanup.receipt)).toEqual({
			outcome: "failed",
			reason: "invalid-receipt",
		});
	});

	test("skips rollback for a provider whose cleaned fields were changed", async () => {
		writeModels({
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
				},
				openai: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/openai/v1",
					apiKey: "wire-proxy",
				},
			},
		});
		const cleanup = await cleanupLegacyJbcentralModels({ env: env() });
		if (cleanup.outcome !== "cleaned") throw new Error("expected cleanup receipt");
		const current = readModels();
		const providers = current.providers as Record<string, Record<string, unknown>>;
		providers.openai = { baseUrl: "https://user.example", apiKey: "user-key" };
		writeModels(current);

		expect(await rollbackLegacyJbcentralCleanup(cleanup.receipt)).toEqual({
			outcome: "partially-rolled-back",
			restoredProviderCount: 1,
			skippedProviderCount: 1,
		});
		expect((readModels().providers as Record<string, unknown>).openai).toEqual({
			baseUrl: "https://user.example",
			apiKey: "user-key",
		});
	});

	test("is typed and non-destructive for absent and invalid files", async () => {
		expect(await cleanupLegacyJbcentralModels({ env: env() })).toEqual({ outcome: "unchanged" });
		expect(existsSync(modelsPath)).toBe(false);
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(modelsPath, "not-json\n");
		expect(await cleanupLegacyJbcentralModels({ env: env() })).toEqual({
			outcome: "failed",
			reason: "invalid-json",
		});
		expect(readFileSync(modelsPath, "utf8")).toBe("not-json\n");
	});

	test("waits for the shared interprocess writer lock before reading and publishing", async () => {
		writeModels({
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
				},
			},
		});
		const release = await lock(modelsPath, { realpath: false });
		let settled = false;
		const cleanup = cleanupLegacyJbcentralModels({ env: env() }).then((result) => {
			settled = true;
			return result;
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(settled).toBe(false);
		await release();
		expect((await cleanup).outcome).toBe("cleaned");
	});

	test("serializes concurrent cleanup calls", async () => {
		writeModels({
			providers: {
				anthropic: {
					baseUrl: "http://127.0.0.1:19516/wire/token/pi/anthropic",
					apiKey: "wire-proxy",
				},
			},
		});
		const outcomes = await Promise.all([
			cleanupLegacyJbcentralModels({ env: env() }),
			cleanupLegacyJbcentralModels({ env: env() }),
		]);
		expect(outcomes.map(({ outcome }) => outcome).sort()).toEqual(["cleaned", "unchanged"]);
	});
});
