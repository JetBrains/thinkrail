// The in-app JetBrains AI wizard, host-side: three idempotent, separately-retryable flows —
// `jbcentral.install` (the official installer, run only after the UI's consent click),
// `jbcentral.login` (spawns `jbcentral login`; the browser opens host-side, the auth URL is scraped
// from output and mirrored to the UI), and `jbcentral.configure` (`add claude` + `add codex` + wire
// the proxy into models.json + hot-reload the model registry). Progress streams as `step`/`log`
// events; jbcentral is an external CLI we don't control, so every spawn is timeboxed and every
// failure lands as a retryable `done ok:false`, never a hang.

import type { AuthFlowStart, AuthStatusResult } from "@thinkrail/contracts";
import {
	jbcentralInstallCommand,
	jbcentralInstallHint,
	resolveJbcentralBin,
	unwireJbcentralProxy,
	wireJbcentralProxy,
} from "@thinkrail/shared/jbcentral";
import { publishAuthEvent } from "./events";
import { type ActiveFlow, finishFlow, flowStart, startFlow } from "./flows";
import { refreshAuthAndModels } from "./refresh";
import { buildAuthStatus } from "./status";

const INSTALL_TIMEOUT_MS = 5 * 60_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000; // the user is off in a browser — generous, but never infinite
const ADD_TIMEOUT_MS = 2 * 60_000;
/** Cap on forwarded log lines per command (the error tail is kept separately). */
const MAX_FORWARDED_LINES = 200;

interface CommandResult {
	code: number;
	timedOut: boolean;
	tail: string;
}

/** Spawn a command, stream its output lines as `log` events, honor the flow's abort + a timeout. */
async function runCommand(
	flow: ActiveFlow,
	argv: string[],
	timeoutMs: number,
	onLine?: (line: string) => void,
): Promise<CommandResult> {
	const proc = Bun.spawn(argv, {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
		env: process.env,
	});
	let timedOut = false;
	const kill = () => {
		try {
			proc.kill();
		} catch {
			/* already gone */
		}
	};
	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, timeoutMs);
	flow.controller.signal.addEventListener("abort", kill);

	let forwarded = 0;
	const tailLines: string[] = [];
	const handleLine = (line: string) => {
		if (line.trim() === "") return;
		tailLines.push(line);
		if (tailLines.length > 20) tailLines.shift();
		if (forwarded < MAX_FORWARDED_LINES) {
			forwarded += 1;
			publishAuthEvent({ kind: "log", flowId: flow.id, line });
		}
		onLine?.(line);
	};
	const pump = async (stream: ReadableStream<Uint8Array>) => {
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of stream) {
			buffer += decoder.decode(chunk, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) handleLine(line);
		}
		if (buffer.trim() !== "") handleLine(buffer);
	};

	try {
		await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
	} catch {
		// A killed process can tear its pipes — the exit code below is the truth.
	}
	const code = await proc.exited;
	clearTimeout(timer);
	flow.controller.signal.removeEventListener("abort", kill);
	return { code, timedOut, tail: tailLines.join("\n") };
}

function step(flow: ActiveFlow, name: string, status: "start" | "ok" | "error", detail?: string) {
	publishAuthEvent({
		kind: "step",
		flowId: flow.id,
		step: name,
		status,
		...(detail ? { detail } : {}),
	});
}

/** Fail a flow: mark the step, emit `done ok:false` (cancelled flows say so). */
function fail(flow: ActiveFlow, stepName: string, detail: string): void {
	const cancelled = flow.controller.signal.aborted;
	step(flow, stepName, "error", cancelled ? "cancelled" : detail);
	finishFlow(flow, false, cancelled ? "cancelled" : detail);
}

// ─── jbcentral.install ────────────────────────────────────────────────────────────────────────────

export function startJbInstall(): AuthFlowStart {
	const flow = startFlow("jb-install");
	void runInstall(flow);
	return flowStart(flow);
}

async function runInstall(flow: ActiveFlow): Promise<void> {
	// Fast path: already installed (a re-probe after "I ran it myself").
	if (resolveJbcentralBin()) {
		step(flow, "install", "ok", "already installed");
		finishFlow(flow, true, "jbcentral is installed");
		return;
	}
	const { display, argv } = jbcentralInstallCommand(process.platform);
	step(flow, "install", "start", display);
	publishAuthEvent({ kind: "log", flowId: flow.id, line: `$ ${display}` });
	const result = await runCommand(flow, argv, INSTALL_TIMEOUT_MS);
	if (result.code !== 0) {
		fail(
			flow,
			"install",
			result.timedOut ? "installer timed out" : result.tail || "installer failed",
		);
		return;
	}
	if (!resolveJbcentralBin()) {
		fail(flow, "install", "installer finished but jbcentral was not found on this machine");
		return;
	}
	step(flow, "install", "ok");
	finishFlow(flow, true, "jbcentral installed");
}

// ─── jbcentral.login ──────────────────────────────────────────────────────────────────────────────

export function startJbLogin(): AuthFlowStart {
	const flow = startFlow("jb-login");
	void runLogin(flow);
	return flowStart(flow);
}

async function runLogin(flow: ActiveFlow): Promise<void> {
	const bin = resolveJbcentralBin();
	if (!bin) {
		fail(flow, "login", jbcentralInstallHint(process.platform));
		return;
	}
	step(flow, "login", "start");
	publishAuthEvent({ kind: "log", flowId: flow.id, line: "$ jbcentral login" });
	// `jbcentral login` opens the browser itself (host-side). Mirror the first URL it prints so the
	// UI can re-open/copy it — and so a remote client (V2) can open it on its own device.
	let urlSent = false;
	const result = await runCommand(flow, [bin, "login"], LOGIN_TIMEOUT_MS, (line) => {
		if (urlSent) return;
		const match = line.match(/https?:\/\/\S+/);
		if (match) {
			urlSent = true;
			publishAuthEvent({ kind: "auth-url", flowId: flow.id, url: match[0] });
		}
	});
	if (result.code !== 0) {
		fail(
			flow,
			"login",
			result.timedOut ? "sign-in timed out" : result.tail || "jbcentral login failed",
		);
		return;
	}
	step(flow, "login", "ok");
	finishFlow(flow, true, "Signed in to JetBrains");
}

// ─── jbcentral.configure ──────────────────────────────────────────────────────────────────────────

export function startJbConfigure(): AuthFlowStart {
	const flow = startFlow("jb-configure");
	void runConfigure(flow);
	return flowStart(flow);
}

async function runConfigure(flow: ActiveFlow): Promise<void> {
	const bin = resolveJbcentralBin();
	if (!bin) {
		fail(flow, "add-claude", jbcentralInstallHint(process.platform));
		return;
	}
	for (const [stepName, provider] of [
		["add-claude", "claude"],
		["add-codex", "codex"],
	] as const) {
		step(flow, stepName, "start");
		publishAuthEvent({ kind: "log", flowId: flow.id, line: `$ jbcentral add ${provider}` });
		const result = await runCommand(flow, [bin, "add", provider], ADD_TIMEOUT_MS);
		if (result.code !== 0) {
			fail(
				flow,
				stepName,
				result.timedOut ? "timed out" : result.tail || `jbcentral add ${provider} failed`,
			);
			return;
		}
		step(flow, stepName, "ok");
	}

	step(flow, "wire-proxy", "start");
	try {
		const { port } = await wireJbcentralProxy(process.env, bin);
		step(flow, "wire-proxy", "ok", `proxy on 127.0.0.1:${port}`);
	} catch (err) {
		fail(flow, "wire-proxy", err instanceof Error ? err.message : String(err));
		return;
	}

	step(flow, "reload-models", "start");
	const modelCount = refreshAuthAndModels();
	step(flow, "reload-models", "ok", `${modelCount} models available`);
	finishFlow(flow, true, `${modelCount} models available`);
}

// ─── jbcentral.unwire (Settings escape hatch — synchronous, not a flow) ──────────────────────────

export async function unwireJbcentral(): Promise<AuthStatusResult> {
	await unwireJbcentralProxy(process.env);
	refreshAuthAndModels();
	return buildAuthStatus();
}
