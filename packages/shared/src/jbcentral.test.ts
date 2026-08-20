import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
	MINIMUM_CENTRAL_VERSION,
	parseJbcentralStatusObservation,
	parseJbcentralVersion,
	probeJbcentralStatus,
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
	test("parses the public version prefix without retaining build metadata", () => {
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

	test("accepts the minimum version and reports artifact presence", async () => {
		const requests: string[][] = [];
		const extensionPath = "/users/test/.pi/agent/extensions/jetbrains-central.ts";
		const deps = adapterDeps({
			exists: (path) => path === extensionPath,
			run: async (request) => {
				requests.push([...request.argv]);
				return {
					outcome: "exited",
					exitCode: 0,
					stdout: `central ${MINIMUM_CENTRAL_VERSION} (synthetic metadata)`,
				};
			},
		});
		expect(await inspectJbcentral(deps)).toEqual({
			executablePath: CENTRAL_BIN,
			extensionPath,
			artifactExists: true,
			status: { state: "supported", version: "1.4.0", configured: true },
		});
		expect(requests).toEqual([[CENTRAL_BIN, "--version"]]);
	});

	test("classifies below-minimum, newer, malformed, absent, and failed probes without raw output", async () => {
		async function inspectOutput(stdout: string, exitCode = 0) {
			return inspectJbcentral(
				adapterDeps({
					run: async () => ({ outcome: "exited", exitCode, stdout }),
				}),
			);
		}

		expect((await inspectOutput("central 1.3.9 (synthetic)")).status).toEqual({
			state: "outdated",
			version: "1.3.9",
		});
		expect((await inspectOutput("central 1.7.0 (synthetic)")).status).toEqual({
			state: "supported",
			version: "1.7.0",
			configured: false,
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

describe("Central status observation", () => {
	const ESC = String.fromCharCode(27);
	/** Central's own rendering: an SGR-styled indicator, a padded label, an SGR-styled value. */
	const statusRow = (label: string, value: string) =>
		`${ESC}[38;2;46;125;50m⣿${ESC}[m ${ESC}[1m${label.padEnd(10)}${ESC}[m ${ESC}[1;38;2;46;125;50m${value}${ESC}[m`;
	const authRow = (value: string) => statusRow("Auth", value);
	const proxyRow = (value: string) => statusRow("Proxy", value);
	const parseAuth = (output: string) => parseJbcentralStatusObservation(output).auth;

	test("trusts only the signed-out marker, and answers unknown when the row is absent", () => {
		expect(parseAuth(authRow("not connected"))).toBe("signed-out");
		// Every other rendering of the row — account, licence, managed server, unseen wording — is credentials.
		for (const value of [
			"JetBrains Team",
			"logged in (AI Pro)",
			"managed by Example Corp · https://central.example.invalid",
			"connected to production",
			"JetBrains Team (session expired)",
		]) {
			expect(parseAuth(authRow(value))).toBe("connected");
		}
		// The `Authentication can't be refreshed` warning is not the Auth row and must not be read as one.
		expect(parseAuth("⚠ Authentication can't be refreshed — run central logout")).toBe("unknown");
		expect(parseAuth("")).toBe("unknown");
		expect(parseAuth("synthetic unrelated output")).toBe("unknown");
	});

	test("trusts only the exact stopped proxy marker", () => {
		expect(parseJbcentralStatusObservation(proxyRow("stopped"))).toEqual({
			auth: "unknown",
			proxy: "stopped",
		});
		for (const value of ["running", "running on port 19516", "starting", "stopped unexpectedly"]) {
			expect(parseJbcentralStatusObservation(proxyRow(value)).proxy).toBe("unknown");
		}
		expect(parseJbcentralStatusObservation("Proxy health unavailable").proxy).toBe("unknown");
	});

	test("reads auth and proxy from one full styled status block", async () => {
		const block = [
			authRow("not connected"),
			proxyRow("stopped"),
			statusRow("Version", "1.7.0"),
			"",
			"Agents",
			`${ESC}[38;2;198;40;40m⠤${ESC}[m ${ESC}[1mPi${ESC}[m installed · not wired`,
		].join("\n");
		const requests: Array<{ argv: readonly string[]; timeoutMs: number }> = [];
		const observation = await probeJbcentralStatus(
			adapterDeps({
				run: async (request) => {
					requests.push({ argv: request.argv, timeoutMs: request.timeoutMs });
					return { outcome: "exited", exitCode: 0, stdout: block };
				},
			}),
		);
		expect(observation).toEqual({ auth: "signed-out", proxy: "stopped" });
		expect(requests).toEqual([{ argv: [CENTRAL_BIN, "status"], timeoutMs: 15_000 }]);
	});

	test("never turns a failed probe into a recovery demand", async () => {
		const secret = "synthetic-sensitive-status-output";
		const failures: JbcentralAdapterDependencies[] = [
			adapterDeps({ which: () => null, exists: () => false }),
			adapterDeps({ run: async () => ({ outcome: "timed-out" }) }),
			adapterDeps({ run: async () => ({ outcome: "output-too-large" }) }),
			adapterDeps({ run: async () => ({ outcome: "exited", exitCode: 3, stdout: secret }) }),
			adapterDeps({
				run: async () => {
					throw new Error(secret);
				},
			}),
		];
		for (const deps of failures) {
			expect(await probeJbcentralStatus(deps)).toEqual({ auth: "unknown", proxy: "unknown" });
		}
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

	test("starts the proxy through reviewed absolute argv and validates the stopped postcondition", async () => {
		const requests: Array<{ argv: readonly string[]; captureStdout: boolean }> = [];
		const run = async (
			request: Parameters<NonNullable<JbcentralAdapterDependencies["run"]>>[0],
		) => {
			requests.push({ argv: request.argv, captureStdout: request.captureStdout });
			const stdout = request.argv[1] === "status" ? "Auth JetBrains Team\nProxy running" : "";
			return { outcome: "exited" as const, exitCode: 0, stdout };
		};
		expect(await runJbcentralAction("start-proxy", adapterDeps({ run }))).toEqual({
			outcome: "succeeded",
			observation: { auth: "connected", proxy: "unknown" },
		});
		expect(requests).toEqual([
			{
				argv: [CENTRAL_BIN, "proxy", "start", "--ensure-updated"],
				captureStdout: false,
			},
			{ argv: [CENTRAL_BIN, "status"], captureStdout: true },
		]);

		expect(
			await runJbcentralAction(
				"start-proxy",
				adapterDeps({
					run: async (request) => ({
						outcome: "exited",
						exitCode: 0,
						stdout: request.argv[1] === "status" ? "Proxy stopped" : "",
					}),
				}),
			),
		).toEqual({ outcome: "failed", reason: "proxy-stopped" });
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

	test("launches login detached with approved argv and a generic result", async () => {
		let argv: readonly string[] = [];
		// A flow that really started is still running when the grace elapses — it is waiting on the browser.
		expect(
			await launchJbcentralLogin(
				adapterDeps({
					launchDetached: (nextArgv) => {
						argv = nextArgv;
						return { exited: new Promise<number>(() => {}) };
					},
				}),
			),
		).toEqual({ outcome: "launched" });
		expect(argv).toEqual([CENTRAL_BIN, "login"]);
		expect(
			await launchJbcentralLogin(
				adapterDeps({
					launchDetached: () => {
						throw new Error("synthetic-private-login-error");
					},
				}),
			),
		).toEqual({ outcome: "failed", reason: "launch-failed" });
	});

	test("a login that dies immediately is a failure, not a launch", async () => {
		// The real `central login` drives its browser handoff from a terminal UI and exits at once without a
		// TTY. Spawning it successfully therefore proves nothing, and reporting `launched` would send the user
		// to a browser that never opened. Every non-zero early exit is a failure...
		for (const code of [1, 12, 127]) {
			expect(
				await launchJbcentralLogin(
					adapterDeps({ launchDetached: () => ({ exited: Promise.resolve(code) }) }),
				),
			).toEqual({ outcome: "failed", reason: "launch-failed" });
		}
		// ...while an immediate *zero* exit is Central's "already signed in" short-circuit, which is success.
		expect(
			await launchJbcentralLogin(
				adapterDeps({ launchDetached: () => ({ exited: Promise.resolve(0) }) }),
			),
		).toEqual({ outcome: "launched" });
		// A spawn that yields no handle at all never reached the executable.
		expect(await launchJbcentralLogin(adapterDeps({ launchDetached: () => null }))).toEqual({
			outcome: "failed",
			reason: "launch-failed",
		});
	});
});

/**
 * The real child-process runner, driven with NO `run` dependency injected. Every other suite here replaces
 * that seam, so the production spawn — its stdout bound, its timeout kill, and its launch failure — has no
 * coverage at all: an injected fake can return `output-too-large` without anything proving the code that
 * decides it exists.
 */
describe("Central process runner (real spawn)", () => {
	let binDir: string;

	function realDeps(script: string): JbcentralAdapterDependencies {
		writeFileSync(
			join(binDir, "central"),
			`#!/bin/sh
${script}
`,
		);
		chmodSync(join(binDir, "central"), 0o755);
		return {
			env: { HOME: binDir, PATH: binDir },
			exists: () => false,
		};
	}

	beforeEach(() => {
		binDir = mkdtempSync(join(tmpdir(), "central-runner-"));
	});

	afterEach(() => {
		rmSync(binDir, { recursive: true, force: true });
	});

	test("parses a real child's bounded stdout", async () => {
		const { status } = await inspectJbcentral(realDeps("printf 'central 1.7.0 (real spawn)\n'"));
		expect(status).toEqual({ state: "supported", version: "1.7.0", configured: false });
	});

	test("a real non-zero exit and a missing executable stay closed reasons", async () => {
		expect((await inspectJbcentral(realDeps("exit 3"))).status).toEqual({
			state: "probe-failed",
			reason: "nonzero-exit",
		});
		rmSync(join(binDir, "central"));
		expect(
			(await inspectJbcentral({ env: { HOME: binDir, PATH: binDir }, exists: () => false })).status,
		).toEqual({ state: "absent" });
	});

	test("stdout at the bound parses, and past it is refused rather than buffered", async () => {
		// Just inside the 4096-byte cap: the bound is strictly greater, so this must still parse.
		const atBound = await inspectJbcentral(realDeps(`printf 'central 1.6.2 '; printf '%4081s' ''`));
		expect(atBound.status).toEqual({ state: "supported", version: "1.6.2", configured: false });

		// Far past it, with a *valid* version prefix — so a runner that ignored the bound would happily
		// report `supported` off the first line instead of refusing to read an unbounded child.
		const flood = await inspectJbcentral(
			realDeps(`printf 'central 1.7.0 '\nyes SYNTHETIC_FLOOD | head -20000`),
		);
		expect(flood.status).toEqual({ state: "probe-failed", reason: "output-too-large" });
		expect(JSON.stringify(flood)).not.toContain("SYNTHETIC_FLOOD");
	});

	test("a child that outlives the version timeout is killed, and the timeout beats its exit code", async () => {
		// The child would exit 0 if it were ever allowed to finish, so `timed-out` winning proves both that
		// the kill happened and that it takes precedence over the dead child's status.
		const started = Date.now();
		const { status } = await inspectJbcentral(realDeps("sleep 20; exit 0"));
		expect(status).toEqual({ state: "probe-failed", reason: "timed-out" });
		expect(Date.now() - started).toBeLessThan(12_000);
		// The probe's own timeout is 5s, so this case cannot fit the default per-test budget.
	}, 20_000);
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

	test("repairs a dropped add/remove event by polling artifact existence only", async () => {
		const extensionPath = "/users/test/.pi/agent/extensions/jetbrains-central.ts";
		const existing = new Set([
			"/users/test",
			"/users/test/.pi",
			"/users/test/.pi/agent",
			"/users/test/.pi/agent/extensions",
		]);
		let invalidations = 0;
		const stop = watchJbcentralArtifact(
			() => {
				invalidations += 1;
			},
			adapterDeps({
				exists: (path) => existing.has(path),
				// Deliberately retain but never invoke the filesystem callback.
				watchDirectory: () => ({ close: () => {} }),
			}),
		);

		const waitForInvalidations = async (expected: number): Promise<void> => {
			const deadline = Date.now() + 1_000;
			while (invalidations < expected && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		};
		existing.add(extensionPath);
		await waitForInvalidations(1);
		existing.delete(extensionPath);
		await waitForInvalidations(2);
		expect(invalidations).toBe(2);
		stop();
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
		const base = "https://central-cli.labs.jb.gg";
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
