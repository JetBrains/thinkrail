#!/usr/bin/env bun

import { existsSync, globSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { defaultSessionDirFor, writeFixtureSession } from "@thinkrail/server/history-test-fixtures";
import { binaryArtifactName } from "./artifactName";

const binary = resolve(
	process.argv[2] ?? join(import.meta.dir, "..", "dist", binaryArtifactName()),
);
if (!existsSync(binary)) {
	console.error(`binary not found at ${binary} — run \`bun run build:binary\` first.`);
	process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "thinkrail-smoke-"));
const cacheDir = join(tmp, "cache");
const homeDir = join(tmp, "home");
const projectDir = join(tmp, "project");
const dataDir = join(tmp, "data");
const agentDir = join(tmp, "pi-agent");

let killHost: () => void = () => {};

function fail(message: string): never {
	console.error(`smoke FAILED: ${message}`);
	killHost();
	console.error(`smoke state kept for inspection: ${tmp}`);
	process.exit(1);
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms),
		),
	]);
}

mkdirSync(homeDir, { recursive: true });

const fakeBinDir = join(tmp, "no-pi-bin");
const centralArtifact = join(homeDir, ".pi", "agent", "extensions", "jetbrains-central.ts");
mkdirSync(fakeBinDir, { recursive: true });
mkdirSync(dirname(centralArtifact), { recursive: true });
const centralFakeSource = join(tmp, "central-fake.ts");
const centralFake = join(fakeBinDir, process.platform === "win32" ? "central.exe" : "central");
writeFileSync(
	centralFakeSource,
	`if (process.argv[2] !== "--version") process.exit(8);\nprocess.stdout.write("central 1.6.2 (synthetic smoke metadata)\\n");\n`,
);
const compileFake = Bun.spawnSync(
	[process.execPath, "build", "--compile", centralFakeSource, "--outfile", centralFake],
	{ cwd: tmp, stdout: "pipe", stderr: "pipe" },
);
if (!compileFake.success || !existsSync(centralFake)) {
	console.error(compileFake.stderr.toString());
	fail(`could not compile the fake Central CLI at ${centralFake}`);
}
writeFileSync(
	centralArtifact,
	`const model = {
  id: "compiled-external-model",
  name: "Compiled external extension model",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 4096,
  api: "openai-completions",
};
export default function syntheticExternalExtension(pi) {
  pi.registerProvider("compiled-external", {
    api: "openai-completions",
    baseUrl: "https://compiled-extension.invalid",
    apiKey: "synthetic-smoke-key",
    models: [model],
  });
}
`,
);
const noPiPath = [
	fakeBinDir,
	...(process.env.PATH ?? "")
		.split(delimiter)
		.filter((entry) => entry.length > 0 && !Bun.which("pi", { PATH: entry })),
].join(delimiter);
if (Bun.which("pi", { PATH: noPiPath }))
	fail("the external-extension smoke PATH unexpectedly contains pi");
if (!Bun.which("git", { PATH: noPiPath }))
	fail("dropping every pi directory from PATH also dropped git — move pi out of git's directory");

const sandboxEnv = {
	HOME: homeDir,
	USERPROFILE: homeDir,
	CLAUDE_CONFIG_DIR: join(homeDir, ".claude"),
	CODEX_HOME: join(homeDir, ".codex"),
	GEMINI_CLI_HOME: homeDir,
	PI_OFFLINE: "1",
	PATH: noPiPath,
	THINKRAIL_NO_ANALYTICS: "1",
};

function hostEnv(overrides: Record<string, string>, unset: string[] = []): Record<string, string> {
	const shadowed = new Set([...Object.keys(overrides), ...unset].map((name) => name.toLowerCase()));
	const inherited: Record<string, string> = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined && !shadowed.has(name.toLowerCase())) inherited[name] = value;
	}
	return { ...inherited, ...overrides };
}

const autoloadDir = join(tmp, "autoload-project");
const preloadMarker = join(autoloadDir, "preload-ran");
mkdirSync(autoloadDir, { recursive: true });
writeFileSync(join(autoloadDir, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
writeFileSync(
	join(autoloadDir, "preload.ts"),
	`import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(preloadMarker)}, "ran");\n`,
);

{
	const subCache = join(tmp, "subcommand-cache");
	const run = Bun.spawnSync([binary, "uninstall", "--help"], {
		env: hostEnv({ ...sandboxEnv, XDG_CACHE_HOME: subCache }),
		stdout: "pipe",
		stderr: "inherit",
		cwd: autoloadDir,
	});
	if (run.exitCode !== 0) fail(`\`uninstall --help\` exited ${run.exitCode}`);
	if (existsSync(preloadMarker)) fail("compiled binary executed a project-local bunfig preload");
	if (!run.stdout.toString().includes("thinkrail uninstall")) {
		fail("`uninstall --help` printed no usage");
	}
	if (existsSync(join(subCache, "thinkrail"))) {
		fail("a subcommand staged the embedded assets — compiled-entry should skip staging for it");
	}
}

const skillDir = join(projectDir, ".claude", "skills", "compiled-portable");
mkdirSync(skillDir, { recursive: true });
writeFileSync(
	join(skillDir, "SKILL.md"),
	"---\nname: compiled-portable\ndescription: Compiled portable smoke skill\n---\n\n# Smoke\n",
);
const gitInit = Bun.spawnSync(["git", "-C", projectDir, "init", "-b", "main"]);
if (gitInit.exitCode !== 0) fail("could not initialise the portable-skill smoke project");
const gitAdd = Bun.spawnSync(["git", "-C", projectDir, "add", "."]);
if (gitAdd.exitCode !== 0) fail("could not stage the portable-skill smoke project");
const gitCommit = Bun.spawnSync([
	"git",
	"-C",
	projectDir,
	"-c",
	"user.name=ThinkRail Smoke",
	"-c",
	"user.email=smoke@thinkrail.invalid",
	"commit",
	"--quiet",
	"-m",
	"seed smoke project",
]);
if (gitCommit.exitCode !== 0) fail("could not commit the portable-skill smoke project");

const spawnCustomAgentHost = () =>
	Bun.spawn([binary, "--no-open", "--port", "24262"], {
		env: hostEnv({
			...sandboxEnv,
			THINKRAIL_DATA_DIR: dataDir,
			PI_CODING_AGENT_DIR: agentDir,
			XDG_CACHE_HOME: cacheDir,
		}),
		stdout: "pipe",
		stderr: "inherit",
	});

async function connectRpc(baseUrl: string): Promise<WebSocket> {
	const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws`);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("WebSocket connection failed")), {
			once: true,
		});
	});
	return socket;
}

let requestSequence = 0;
function rpc(socket: WebSocket, method: string, params: unknown): Promise<unknown> {
	const id = `smoke_${++requestSequence}`;
	return new Promise((resolve, reject) => {
		const onMessage = (event: MessageEvent) => {
			if (typeof event.data !== "string") return;
			const frame = JSON.parse(event.data) as {
				id?: string;
				ok?: boolean;
				result?: unknown;
				error?: string;
			};
			if (frame.id !== id) return;
			socket.removeEventListener("message", onMessage);
			if (frame.ok) resolve(frame.result);
			else reject(new Error(frame.error ?? `${method} failed`));
		};
		socket.addEventListener("message", onMessage);
		socket.send(JSON.stringify({ id, method, params }));
	});
}

async function readServedUrlFrom(processHandle: {
	stdout: ReadableStream<Uint8Array>;
}): Promise<string> {
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of processHandle.stdout) {
		buffered += decoder.decode(chunk, { stream: true });
		const match = buffered.match(/thinkrail → (http:\/\/\S+)/);
		if (match) return match[1];
	}
	throw new Error(`stdout closed without a serving URL (output: ${JSON.stringify(buffered)})`);
}

function hasExternalExtensionModel(models: unknown): boolean {
	return (
		Array.isArray(models) &&
		models.some(
			(model) =>
				typeof model === "object" &&
				model !== null &&
				(model as { provider?: string; id?: string }).provider === "compiled-external" &&
				(model as { provider?: string; id?: string }).id === "compiled-external-model",
		)
	);
}

function centralFixtureState(): string {
	const exe = existsSync(centralFake);
	const version = exe
		? Bun.spawnSync([centralFake, "--version"], { stdout: "pipe", stderr: "pipe" })
		: null;
	return JSON.stringify({
		exe,
		resolved: Bun.which("central", { PATH: noPiPath }),
		artifact: existsSync(centralArtifact),
		version: version && { code: version.exitCode, out: version.stdout.toString().trim() },
	});
}

async function centralStatus(socket: WebSocket): Promise<{ state?: string } | null> {
	try {
		const report = (await within(
			rpc(socket, "provider.status", {}),
			10_000,
			"provider.status",
		)) as { jbcentral?: { state?: string } };
		return report.jbcentral ?? null;
	} catch (err) {
		return { state: `unreadable (${err instanceof Error ? err.message : String(err)})` };
	}
}

async function settledCentralStatus(socket: WebSocket): Promise<{ state?: string } | null> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const status = await centralStatus(socket);
		if (status?.state !== "configuring") return status;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return await centralStatus(socket);
}

async function assertExternalExtensionLoaded(
	socket: WebSocket,
	agentDirKind: string,
): Promise<void> {
	const models = await within(rpc(socket, "model.list", {}), 20_000, `${agentDirKind} model.list`);
	const status = await settledCentralStatus(socket);
	if (hasExternalExtensionModel(models) && status?.state === "configured") return;
	fail(
		`compiled binary did not load the global external extension with ${agentDirKind} (Central status: ${JSON.stringify(status)}, fixture: ${centralFixtureState()})`,
	);
}

async function assertDefaultAgentDirExternalExtension(): Promise<void> {
	const probe = Bun.spawn([binary, "--no-open", "--port", "24312"], {
		env: hostEnv(
			{
				...sandboxEnv,
				THINKRAIL_DATA_DIR: join(tmp, "default-agent-data"),
				XDG_CACHE_HOME: join(tmp, "default-agent-cache"),
			},
			["PI_CODING_AGENT_DIR"],
		),
		stdout: "pipe",
		stderr: "inherit",
	});
	let socket: WebSocket | null = null;
	try {
		const url = await within(
			Promise.race([
				readServedUrlFrom(probe),
				probe.exited.then((code) => {
					throw new Error(`default-agent binary probe exited early with code ${code}`);
				}),
			]),
			30_000,
			"default-agent binary probe did not report a serving URL",
		);
		socket = await within(connectRpc(url), 10_000, "default-agent WebSocket connect");
		await assertExternalExtensionLoaded(socket, "the default agent dir");
		probe.kill("SIGTERM");
		await within(probe.exited, 15_000, "default-agent probe shutdown");
	} finally {
		socket?.close();
		if (probe.exitCode === null) probe.kill("SIGKILL");
	}
}

async function assertOAuthLoginReachesAuthUrl(socket: WebSocket): Promise<void> {
	let loginId: string | undefined;
	const authUrl = new Promise<string>((resolve, reject) => {
		const settle = (fn: () => void) => {
			socket.removeEventListener("message", onPush);
			fn();
		};
		const onPush = (event: MessageEvent) => {
			if (typeof event.data !== "string") return;
			const message = JSON.parse(event.data) as {
				channel?: string;
				data?: {
					loginId?: string;
					frame?: {
						kind: string;
						url?: string;
						message?: string;
						options?: { id: string; label: string }[];
					};
				};
			};
			if (message.channel !== "provider.login" || !message.data?.frame) return;
			const { loginId: pushLoginId, frame } = message.data;
			switch (frame.kind) {
				case "select": {
					const browser = frame.options?.find((o) => /browser/i.test(`${o.id} ${o.label}`));
					const optionId = browser?.id ?? frame.options?.[0]?.id;
					if (!optionId || !pushLoginId) {
						return settle(() =>
							reject(new Error(`unanswerable select frame: ${JSON.stringify(frame)}`)),
						);
					}
					rpc(socket, "provider.loginReply", { loginId: pushLoginId, value: optionId }).catch(
						(err) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
					);
					return;
				}
				case "authUrl":
					return settle(() => resolve(frame.url ?? ""));
				case "error":
					return settle(() => reject(new Error(`login flow failed: ${frame.message}`)));
				default:
					return;
			}
		};
		socket.addEventListener("message", onPush);
		rpc(socket, "provider.loginStart", { providerId: "openai-codex" }).then(
			(result) => {
				loginId = (result as { loginId?: string }).loginId;
			},
			(err) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
		);
	});

	try {
		const reached = await within(authUrl, 30_000, "Codex OAuth login did not reach its auth URL");
		if (!reached.includes("auth.openai.com")) fail(`unexpected auth URL: ${reached}`);
	} finally {
		if (loginId !== undefined) rpc(socket, "provider.loginCancel", { loginId }).catch(() => {});
	}
}

let rpcSocket: WebSocket | null = null;
try {
	await assertDefaultAgentDirExternalExtension();
	const proc = spawnCustomAgentHost();
	killHost = () => proc.kill("SIGKILL");
	const url = await within(
		Promise.race([
			readServedUrlFrom(proc),
			proc.exited.then((code) => {
				throw new Error(`binary exited early with code ${code}`);
			}),
		]),
		30_000,
		"binary did not report a serving URL",
	);

	const health = await within(fetch(`${url}/health`), 10_000, "GET /health");
	if (!health.ok || (await health.text()) !== "ok") fail(`/health answered ${health.status}`);

	const index = await within(fetch(url), 10_000, "GET /");
	const body = await index.text();
	if (!index.ok || !body.includes("ThinkRail")) {
		fail(`staged web UI not served: / answered ${index.status}`);
	}

	rpcSocket = await within(connectRpc(url), 10_000, "WebSocket connect");
	await assertExternalExtensionLoaded(rpcSocket, "a custom agent dir");
	const project = (await within(
		rpc(rpcSocket, "project.open", { path: projectDir }),
		10_000,
		"project.open",
	)) as { id?: string };
	if (!project.id) fail("project.open returned no project id");
	const workspaces = (await within(
		rpc(rpcSocket, "workspace.list", { projectId: project.id }),
		10_000,
		"workspace.list",
	)) as { id?: string; kind?: string; worktreePath?: string }[];
	const defaultWorkspace = workspaces.find((workspace) => workspace.kind === "default");
	const workspaceId = defaultWorkspace?.id;
	if (!workspaceId) fail("workspace.list returned no Default workspace");

	const worktreePath = defaultWorkspace?.worktreePath;
	if (!worktreePath) fail("workspace.list returned no worktreePath for the Default workspace");
	const doomedTranscript = writeFixtureSession(defaultSessionDirFor(agentDir, worktreePath), {
		cwd: worktreePath,
		name: "compiled trash probe",
		messages: [{ role: "user", text: "move this transcript to trash", timestamp: Date.now() }],
	});

	await within(
		rpc(rpcSocket, "session.delete", { sessionId: doomedTranscript.id, workspaceId }),
		10_000,
		"session.delete compiled trash probe",
	);
	if (existsSync(doomedTranscript.path)) fail("session.delete left the seeded transcript on disk");

	await within(
		rpc(rpcSocket, "project.setTrust", { id: project.id, trusted: true }),
		10_000,
		"project.setTrust",
	);
	const commands = await within(
		rpc(rpcSocket, "skill.list", { projectId: project.id }),
		30_000,
		"skill.list",
	);
	if (!Array.isArray(commands)) fail("skill.list did not return an array");
	const portable = commands.find(
		(command) =>
			typeof command === "object" &&
			command !== null &&
			(command as { name?: string }).name === "skill:compiled-portable",
	) as { description?: string; sourceInfo?: { scope?: string } } | undefined;
	if (portable?.description !== "Compiled portable smoke skill") {
		fail("compiled skill.list did not load the cross-agent project alias");
	}
	if (portable.sourceInfo?.scope !== "project") {
		fail("compiled skill.list did not preserve project skill provenance");
	}
	if (
		!commands.some(
			(command) =>
				typeof command === "object" &&
				command !== null &&
				(command as { name?: string }).name === "skill:brainstorming",
		)
	) {
		fail("compiled skill.list did not load bundled workflow skills");
	}

	await assertOAuthLoginReachesAuthUrl(rpcSocket);

	for (const helper of ["macos-trash", "windows-trash.exe"]) {
		if (globSync(join(cacheDir, "thinkrail", "runtime", "*", helper)).length === 0) {
			fail(`native trash helper "${helper}" was not staged under ${cacheDir}`);
		}
	}

	// Keep in sync with the family table in packages/pi-thinkrail-workflow/skills/SPEC.md.
	for (const skill of [
		"spec-graph",
		"asking-user-questions",
		"brainstorming",
		"choosing-a-workflow",
		"importing-a-codebase",
		"setting-up-a-project",
		"starting-a-new-project",
		"writing-specs",
		"writing-workflow-skills",
	]) {
		const hits = globSync(join(cacheDir, "thinkrail", "skills", "*", skill, "SKILL.md"));
		if (hits.length === 0) fail(`bundled skill "${skill}" was not staged under ${cacheDir}`);
	}
	if (globSync(join(cacheDir, "thinkrail", "skills", "*", "SPEC.md")).length === 0)
		fail(`the workflow family spec (skills/SPEC.md) was not staged under ${cacheDir}`);

	proc.kill("SIGTERM");
	const exitCode = await within(proc.exited, 15_000, "shutdown on SIGTERM");
	if (process.platform !== "win32" && exitCode !== 0) {
		fail(`SIGTERM shutdown exited with code ${exitCode}`);
	}

	console.log(
		`smoke OK: ${binary} booted at ${url}, loaded the external extension for default/custom agent dirs with no pi on PATH, served the UI + staged skills + portable alias, trashed a transcript, OAuth reached its auth URL, exited cleanly.`,
	);
} catch (err) {
	fail(err instanceof Error ? err.message : String(err));
} finally {
	rpcSocket?.close();
	rmSync(tmp, { recursive: true, force: true });
}
