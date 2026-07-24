#!/usr/bin/env bun
// Boot-smoke the compiled `thinkrail` binary: start it against throwaway data/agent/cache dirs and
// assert it comes up, serves the staged web UI, staged the bundled skills, and shuts down cleanly on
// SIGTERM. This gates the regression class that only exists inside the compiled artifact (dev + e2e run
// from source and can never see it) — extension/asset wiring that resolves out of `node_modules` or the
// source tree at runtime.
//
// Usage:  bun run scripts/smoke-binary.ts [path-to-binary]
//   Default binary: `dist/thinkrail` — run `bun run build:binary` first (we error if it's missing).

import { existsSync, globSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve(process.argv[2] ?? join(import.meta.dir, "..", "dist", "thinkrail"));
if (!existsSync(binary)) {
	console.error(`binary not found at ${binary} — run \`bun run build:binary\` first.`);
	process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "thinkrail-smoke-"));
const cacheDir = join(tmp, "cache");
const homeDir = join(tmp, "home");
const projectDir = join(tmp, "project");

function fail(message: string): never {
	console.error(`smoke FAILED: ${message}`);
	process.exit(1);
}

/** `promise`, or fail with `what` after `ms`. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms),
		),
	]);
}

mkdirSync(homeDir, { recursive: true });
const skillDir = join(projectDir, ".claude", "skills", "compiled-portable");
mkdirSync(skillDir, { recursive: true });
writeFileSync(
	join(skillDir, "SKILL.md"),
	"---\nname: compiled-portable\ndescription: Compiled portable smoke skill\n---\n\n# Smoke\n",
);
const gitInit = Bun.spawnSync(["git", "-C", projectDir, "init", "-b", "main"]);
if (gitInit.exitCode !== 0) fail("could not initialise the portable-skill smoke project");

const proc = Bun.spawn([binary, "--no-open", "--port", "24262"], {
	env: {
		...process.env,
		// Full isolation: never touch the runner/dev machine's real state, and force a fresh
		// cache so the binary's staging path (web assets + skills) is exercised from scratch.
		THINKRAIL_DATA_DIR: join(tmp, "data"),
		PI_CODING_AGENT_DIR: join(tmp, "pi-agent"),
		XDG_CACHE_HOME: cacheDir,
		HOME: homeDir,
		CLAUDE_CONFIG_DIR: join(homeDir, ".claude"),
		CODEX_HOME: join(homeDir, ".codex"),
		GEMINI_CLI_HOME: homeDir,
	},
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

/**
 * Drive a real OAuth sign-in far enough to prove the flow module is inside the binary: start a Codex
 * OAuth login, answer the login-method select over the push channel, and require the `authUrl` frame.
 * This pins the seam that statically registers pi's OAuth flows (`registerBundledRuntime`) — pi
 * otherwise loads them through bundler-opaque dynamic imports that resolve from `node_modules`, so
 * **only the compiled artifact** can regress here (every OAuth sign-in dies with `Cannot find module
 * './openai-codex.js'`). Offline + credential-free: pi's flow does PKCE + a local callback server
 * before notifying the URL, and the login is cancelled right after. Frames are hand-rolled JSON — the
 * cli module doesn't import `contracts` (its boundary); the shapes are pinned by the host's wire tests.
 */
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
					// The Codex flow first asks browser-vs-device-code; pick the browser method (no network).
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
					// Pre-registration this is exactly "ResolveMessage: Cannot find module './openai-codex.js'".
					return settle(() => reject(new Error(`login flow failed: ${frame.message}`)));
				default:
					return; // progress etc. — keep waiting
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
		// Best-effort: unblocks pi's parked manual-code prompt; host shutdown cancels any stragglers.
		if (loginId !== undefined) rpc(socket, "provider.loginCancel", { loginId }).catch(() => {});
	}
}

/** The URL from the CLI's `thinkrail → http://…` line (it may scan past a busy port). */
async function readServedUrl(): Promise<string> {
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of proc.stdout) {
		buffered += decoder.decode(chunk, { stream: true });
		const match = buffered.match(/thinkrail → (http:\/\/\S+)/);
		if (match) return match[1];
	}
	throw new Error(`stdout closed without a serving URL (output: ${JSON.stringify(buffered)})`);
}

let rpcSocket: WebSocket | null = null;
try {
	const url = await within(
		Promise.race([
			readServedUrl(),
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

	// Exercise the binary's actual resource-loader mode, not only staged files: a recognized project alias
	// and a bundled skill must coexist in the pre-session catalog, with truthful project provenance.
	rpcSocket = await within(connectRpc(url), 10_000, "WebSocket connect");
	const project = (await within(
		rpc(rpcSocket, "project.open", { path: projectDir }),
		10_000,
		"project.open",
	)) as { id?: string };
	if (!project.id) fail("project.open returned no project id");
	// Project-scoped aliases are gated behind trust — grant it so the compiled skill.list surfaces the
	// committed `.claude/skills` alias below (personal/bundled skills would load regardless).
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

	// A real OAuth sign-in must reach its auth URL — pi's statically-registered flows working inside
	// the artifact (registerBundledRuntime), reusing the live RPC socket for the push-channel frames.
	await assertOAuthLoginReachesAuthUrl(rpcSocket);

	// The bundled extensions' skills must be staged to the real filesystem (pi reads SKILL.md via fs).
	// Full inventory — pi-spec-graph's skill + the whole pi-thinkrail-workflow family (keep in sync with
	// the family table in packages/pi-thinkrail-workflow/skills/SPEC.md). `choosing-a-workflow` matters
	// most: the always-on workflow rule points every agent run at it.
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
	// The workflow family's meta-spec is load-bearing at runtime (writing-workflow-skills reads it
	// from beside the staged skill dirs), so its staging is asserted too.
	if (globSync(join(cacheDir, "thinkrail", "skills", "*", "SPEC.md")).length === 0)
		fail(`the workflow family spec (skills/SPEC.md) was not staged under ${cacheDir}`);

	proc.kill("SIGTERM");
	const exitCode = await within(proc.exited, 15_000, "shutdown on SIGTERM");
	// Windows has no real SIGTERM: Bun force-terminates the process, so the CLI's graceful handler never
	// runs and the exit code isn't meaningful — we only require that it terminates within the timeout.
	// Elsewhere the handler must run and exit 0.
	if (process.platform !== "win32" && exitCode !== 0) {
		fail(`SIGTERM shutdown exited with code ${exitCode}`);
	}

	console.log(
		`smoke OK: ${binary} booted at ${url}, served the UI + staged skills + portable alias, OAuth reached its auth URL, exited cleanly.`,
	);
} catch (err) {
	proc.kill("SIGKILL");
	fail(err instanceof Error ? err.message : String(err));
} finally {
	rpcSocket?.close();
	rmSync(tmp, { recursive: true, force: true });
}
