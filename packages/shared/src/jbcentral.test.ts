import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	inspectJbcentral,
	isJbcentralInstalled,
	type JbcentralAdapterDependencies,
	jbcentralExtensionPath,
	jbcentralInstall,
	launchJbcentralLogin,
	parseJbcentralVersion,
	REVIEWED_CENTRAL_VERSION,
	resolveJbcentralBin,
	runJbcentralAction,
	watchJbcentralArtifact,
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
			artifactExists: true,
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
				artifactExists: false,
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

describe("Central artifact watcher", () => {
	test("re-arms from the nearest existing parent without reading the artifact", async () => {
		const existing = new Set(["/users/test"]);
		const callbacks = new Map<string, () => void>();
		const watched: string[] = [];
		const closed: string[] = [];
		let invalidations = 0;
		const stop = watchJbcentralArtifact(
			() => {
				invalidations += 1;
			},
			adapterDeps({
				exists: (path) => existing.has(path),
				watchDirectory: (path, callback) => {
					watched.push(path);
					callbacks.set(path, callback);
					return { close: () => closed.push(path) };
				},
			}),
		);
		expect(watched).toEqual(["/users/test"]);

		existing.add("/users/test/.pi");
		callbacks.get("/users/test")?.();
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(watched.at(-1)).toBe("/users/test/.pi");

		existing.add("/users/test/.pi/agent/extensions");
		callbacks.get("/users/test/.pi")?.();
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(watched.at(-1)).toBe("/users/test/.pi/agent/extensions");
		expect(invalidations).toBe(2);
		expect(closed).toEqual(["/users/test", "/users/test/.pi"]);

		stop();
		callbacks.get("/users/test/.pi/agent/extensions")?.();
		expect(invalidations).toBe(2);
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
