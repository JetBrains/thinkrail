import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { defaultSessionDirFor, writeFixtureSession } from "@thinkrail/server/history-test-fixtures";

export interface ArtifactResources {
	readonly skillsDir: string;
	readonly trashHelpers: {
		readonly macos: string;
		readonly windows: string;
	};
}

export interface RunningArtifactHost {
	readonly origin: string;
	readonly resources: ArtifactResources;
	stop(): Promise<void>;
}

export interface ArtifactHostAdapter {
	readonly name: string;
	launch(env: Record<string, string>, label: string): Promise<RunningArtifactHost>;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms),
		),
	]);
}

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
	const id = `artifact_${++requestSequence}`;
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

function assertExternalModel(models: unknown): asserts models is Record<string, unknown>[] {
	assert(Array.isArray(models), "model.list did not return an array");
	assert(
		models.some(
			(model) =>
				typeof model === "object" &&
				model !== null &&
				(model as { provider?: string; id?: string }).provider === "compiled-external" &&
				(model as { provider?: string; id?: string }).id === "compiled-external-model",
		),
		"global external extension model is missing",
	);
}

async function assertCentralConfigured(socket: WebSocket, label: string): Promise<void> {
	let state: unknown;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const status = (await within(
			rpc(socket, "provider.status", {}),
			10_000,
			`${label} status`,
		)) as {
			jbcentral?: { state?: unknown };
		};
		state = status.jbcentral?.state;
		if (state === "configured") return;
		if (state !== "configuring") break;
		await Bun.sleep(250);
	}
	throw new Error(`${label} Central state is ${JSON.stringify(state)}, expected configured`);
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
			if (frame.kind === "select") {
				const browser = frame.options?.find((option) =>
					/browser/i.test(`${option.id} ${option.label}`),
				);
				const optionId = browser?.id ?? frame.options?.[0]?.id;
				if (!optionId || !pushLoginId) {
					settle(() => reject(new Error(`unanswerable select frame: ${JSON.stringify(frame)}`)));
					return;
				}
				rpc(socket, "provider.loginReply", { loginId: pushLoginId, value: optionId }).catch(
					(error) =>
						settle(() => reject(error instanceof Error ? error : new Error(String(error)))),
				);
				return;
			}
			if (frame.kind === "authUrl") settle(() => resolve(frame.url ?? ""));
			if (frame.kind === "error") {
				settle(() => reject(new Error(`login flow failed: ${frame.message}`)));
			}
		};
		socket.addEventListener("message", onPush);
		rpc(socket, "provider.loginStart", { providerId: "openai-codex" }).then(
			(result) => {
				loginId = (result as { loginId?: string }).loginId;
			},
			(error) => settle(() => reject(error instanceof Error ? error : new Error(String(error)))),
		);
	});
	try {
		const reached = await within(authUrl, 30_000, "Codex OAuth auth URL");
		assert(reached.includes("auth.openai.com"), `unexpected auth URL: ${reached}`);
	} finally {
		if (loginId !== undefined) rpc(socket, "provider.loginCancel", { loginId }).catch(() => {});
	}
}

function hostEnvironment(
	overrides: Record<string, string>,
	unset: string[] = [],
): Record<string, string> {
	const shadowed = new Set([...Object.keys(overrides), ...unset].map((name) => name.toLowerCase()));
	const inherited: Record<string, string> = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined && !shadowed.has(name.toLowerCase())) inherited[name] = value;
	}
	return { ...inherited, ...overrides };
}

function createCentralExecutable(fakeBinDir: string): void {
	if (process.platform !== "win32") {
		writeFileSync(
			join(fakeBinDir, "central"),
			'#!/bin/sh\n[ "$1" = "--version" ] || exit 8\nprintf \'central 1.6.2 (synthetic artifact metadata)\\n\'\n',
			{ mode: 0o755 },
		);
		return;
	}
	const source = join(fakeBinDir, "central.ts");
	writeFileSync(
		source,
		'if (process.argv[2] !== "--version") process.exit(8); console.log("central 1.6.2 (synthetic artifact metadata)");\n',
	);
	const build = Bun.spawnSync([
		process.execPath,
		"build",
		"--compile",
		source,
		"--outfile",
		join(fakeBinDir, "central.exe"),
	]);
	assert(build.success, `could not build the synthetic Central executable: ${build.stderr}`);
}

export async function runArtifactHostProbes(adapter: ArtifactHostAdapter): Promise<void> {
	const root = mkdtempSync(join(tmpdir(), `thinkrail-${adapter.name}-artifact-`));
	const homeDir = join(root, "home");
	const fakeBinDir = join(root, "no-pi-bin");
	const projectDir = join(root, "project");
	const agentDir = join(root, "pi-agent");
	mkdirSync(homeDir, { recursive: true });
	mkdirSync(fakeBinDir, { recursive: true });
	createCentralExecutable(fakeBinDir);
	const centralArtifact = join(homeDir, ".pi", "agent", "extensions", "jetbrains-central.ts");
	mkdirSync(dirname(centralArtifact), { recursive: true });
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
	const inheritedPath = (process.env.PATH ?? "")
		.split(delimiter)
		.filter((directory) => directory && !Bun.which("pi", { PATH: directory }));
	const noPiPath = [fakeBinDir, ...inheritedPath].join(delimiter);
	assert(!Bun.which("pi", { PATH: noPiPath }), "probe PATH unexpectedly contains pi");
	assert(Bun.which("git", { PATH: noPiPath }), "probe PATH does not contain git");

	const skillDir = join(projectDir, ".claude", "skills", "compiled-portable");
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, "SKILL.md"),
		"---\nname: compiled-portable\ndescription: Compiled portable smoke skill\n---\n\n# Smoke\n",
	);
	for (const command of [
		["git", "-C", projectDir, "init", "-b", "main"],
		["git", "-C", projectDir, "add", "."],
		[
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
			"seed artifact project",
		],
	]) {
		assert(Bun.spawnSync(command).success, `fixture command failed: ${command.join(" ")}`);
	}

	const baseEnv: Record<string, string> = {
		PI_OFFLINE: "1",
		HOME: homeDir,
		USERPROFILE: homeDir,
		CLAUDE_CONFIG_DIR: join(homeDir, ".claude"),
		CODEX_HOME: join(homeDir, ".codex"),
		GEMINI_CLI_HOME: homeDir,
		PATH: noPiPath,
		THINKRAIL_NO_ANALYTICS: "1",
	};
	let defaultHost: RunningArtifactHost | undefined;
	let customHost: RunningArtifactHost | undefined;
	let socket: WebSocket | undefined;
	try {
		const defaultEnv = hostEnvironment(
			{
				...baseEnv,
				THINKRAIL_DATA_DIR: join(root, "default-data"),
				XDG_CACHE_HOME: join(root, "default-cache"),
			},
			["PI_CODING_AGENT_DIR"],
		);
		defaultHost = await within(
			adapter.launch(defaultEnv, "default-agent"),
			30_000,
			"default host launch",
		);
		socket = await within(connectRpc(defaultHost.origin), 10_000, "default host WebSocket");
		assertExternalModel(await within(rpc(socket, "model.list", {}), 20_000, "default model.list"));
		await assertCentralConfigured(socket, "default-agent");
		socket.close();
		socket = undefined;
		await defaultHost.stop();
		defaultHost = undefined;

		const customEnv = hostEnvironment({
			...baseEnv,
			THINKRAIL_DATA_DIR: join(root, "data"),
			PI_CODING_AGENT_DIR: agentDir,
			XDG_CACHE_HOME: join(root, "cache"),
		});
		customHost = await within(
			adapter.launch(customEnv, "custom-agent"),
			30_000,
			"custom host launch",
		);
		const health = await within(fetch(`${customHost.origin}/health`), 10_000, "GET /health");
		assert(health.ok && (await health.text()) === "ok", `/health answered ${health.status}`);
		const index = await within(fetch(customHost.origin), 10_000, "GET /");
		assert(index.ok && (await index.text()).includes("ThinkRail"), "web UI was not served");
		socket = await within(connectRpc(customHost.origin), 10_000, "custom host WebSocket");
		const models = await within(rpc(socket, "model.list", {}), 20_000, "custom model.list");
		assertExternalModel(models);
		await assertCentralConfigured(socket, "custom-agent");
		const externalModel = models.find(
			(model) => model.provider === "compiled-external" && model.id === "compiled-external-model",
		);
		assert(externalModel, "external model lookup failed after assertion");

		const project = (await within(
			rpc(socket, "project.open", { path: projectDir }),
			10_000,
			"project.open",
		)) as { id?: string };
		assert(project.id, "project.open returned no project id");
		const workspaces = (await within(
			rpc(socket, "workspace.list", { projectId: project.id }),
			10_000,
			"workspace.list",
		)) as { id?: string; kind?: string; worktreePath?: string }[];
		const workspace = workspaces.find((entry) => entry.kind === "default");
		assert(workspace?.id && workspace.worktreePath, "Default workspace is missing");
		const transcript = writeFixtureSession(defaultSessionDirFor(agentDir, workspace.worktreePath), {
			cwd: workspace.worktreePath,
			name: "artifact trash probe",
			messages: [{ role: "user", text: "move to trash", timestamp: Date.now() }],
		});
		await within(
			rpc(socket, "session.delete", { sessionId: transcript.id, workspaceId: workspace.id }),
			10_000,
			"session.delete",
		);
		assert(!existsSync(transcript.path), "session.delete left the transcript on disk");
		await within(
			rpc(socket, "project.setTrust", { id: project.id, trusted: true }),
			10_000,
			"trust",
		);
		const skills = await within(
			rpc(socket, "skill.list", { projectId: project.id }),
			30_000,
			"skill.list",
		);
		assert(Array.isArray(skills), "skill.list did not return an array");
		const portable = skills.find(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				(entry as { name?: string }).name === "skill:compiled-portable",
		) as { description?: string; sourceInfo?: { scope?: string } } | undefined;
		assert(portable?.description === "Compiled portable smoke skill", "portable skill is missing");
		assert(portable.sourceInfo?.scope === "project", "portable skill provenance is wrong");
		assert(
			skills.some(
				(entry) =>
					typeof entry === "object" &&
					entry !== null &&
					(entry as { name?: string }).name === "skill:brainstorming",
			),
			"bundled workflow skill is missing",
		);
		const created = (await within(
			rpc(socket, "session.create", { workspaceId: workspace.id, model: externalModel }),
			30_000,
			"session.create with bundled factories",
		)) as { sessionId?: string };
		assert(created.sessionId, "session.create returned no session id");
		const commands = await within(
			rpc(socket, "session.getCommands", { sessionId: created.sessionId }),
			10_000,
			"session.getCommands",
		);
		assert(Array.isArray(commands), "session.getCommands did not return an array");
		assert(
			commands.some(
				(entry) =>
					typeof entry === "object" &&
					entry !== null &&
					(entry as { name?: string }).name === "skill:brainstorming",
			),
			"session resource loader omitted bundled skills",
		);
		await within(
			rpc(socket, "session.dispose", { sessionId: created.sessionId }),
			10_000,
			"session.dispose",
		);
		await assertOAuthLoginReachesAuthUrl(socket);

		for (const helper of Object.values(customHost.resources.trashHelpers)) {
			assert(existsSync(helper), `trash helper is missing: ${helper}`);
		}
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
			assert(
				existsSync(join(customHost.resources.skillsDir, skill, "SKILL.md")),
				`skill file missing: ${skill}`,
			);
		}
		assert(existsSync(join(customHost.resources.skillsDir, "SPEC.md")), "workflow SPEC is missing");
		socket.close();
		socket = undefined;
		await customHost.stop();
		customHost = undefined;
	} finally {
		socket?.close();
		await defaultHost?.stop().catch(() => {});
		await customHost?.stop().catch(() => {});
		rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}
