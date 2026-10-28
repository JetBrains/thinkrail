import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoginFrame, LoginPush, ProviderStatusReport } from "@thinkrail/contracts";
import { toolHomeEnv } from "@thinkrail/shared/toolHomes";

const repoRoot = join(import.meta.dir, "..");
const FLOW_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const BOOT_TIMEOUT_MS = 30_000;
const MAX_SELECT_DEPTH = 3;
const FIRST_USER_STEPS: ReadonlySet<LoginFrame["kind"]> = new Set([
	"authUrl",
	"deviceCode",
	"prompt",
]);

interface Outcome {
	flow: string;
	trail: string[];
	ok: boolean;
}

function describeFrame(frame: LoginFrame): string {
	switch (frame.kind) {
		case "authUrl":
			return `sign-in page ${new URL(frame.url).host}`;
		case "deviceCode":
			return `device code at ${new URL(frame.verificationUri).host}`;
		case "select":
			return `choice [${frame.options.map((o) => o.id).join(" | ")}]`;
		case "prompt":
			return `${frame.secret ? "secret " : ""}prompt "${frame.message}"`;
		case "error":
			return `ERROR "${frame.message}"`;
		default:
			return frame.kind;
	}
}

interface Reply {
	resolve: (m: { ok: boolean; result?: unknown }) => void;
	reject: (error: Error) => void;
}

class Wire {
	private seq = 0;
	private readonly replies = new Map<string, Reply>();
	readonly frames = new Map<string, LoginFrame[]>();

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("close", () => {
			for (const reply of this.replies.values()) reply.reject(new Error("host connection closed"));
			this.replies.clear();
		});
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id && this.replies.has(message.id)) {
				this.replies.get(message.id)?.resolve(message);
				this.replies.delete(message.id);
			} else if (message.channel === "provider.login") {
				const push = message.data as LoginPush;
				const list = this.frames.get(push.loginId) ?? [];
				list.push(push.frame);
				this.frames.set(push.loginId, list);
			}
		});
	}

	static async connect(port: number): Promise<Wire> {
		const socket = new WebSocket(`ws://localhost:${port}/ws`);
		await new Promise((resolve, reject) => {
			socket.addEventListener("open", resolve, { once: true });
			socket.addEventListener("error", reject, { once: true });
		});
		return new Wire(socket);
	}

	async request<T>(method: string, params: unknown): Promise<T> {
		const id = `smoke_${++this.seq}`;
		const reply = await new Promise<{ ok: boolean; result?: unknown }>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.replies.delete(id);
				reject(new Error(`${method} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
			}, REQUEST_TIMEOUT_MS);
			this.replies.set(id, {
				resolve: (message) => {
					clearTimeout(timer);
					resolve(message);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
		if (!reply.ok) throw new Error(`${method} failed`);
		return reply.result as T;
	}

	close(): void {
		this.socket.close();
	}
}

async function runFlow(
	wire: Wire,
	providerId: string,
	type: "oauth" | "api_key",
	choices: string[],
): Promise<{ trail: string[]; ok: boolean; select?: string[] }> {
	const { loginId } = await wire.request<{ loginId: string }>("provider.loginStart", {
		providerId,
		type,
	});
	const trail: string[] = [];
	let seen = 0;
	let picked = 0;
	const deadline = Date.now() + FLOW_TIMEOUT_MS;
	try {
		while (Date.now() < deadline) {
			await Bun.sleep(100);
			const frames = wire.frames.get(loginId) ?? [];
			for (; seen < frames.length; seen++) {
				const frame = frames[seen];
				if (!frame || frame.kind === "progress") continue;
				trail.push(describeFrame(frame));
				if (frame.kind === "select") {
					const choice = choices[picked++];
					if (choice === undefined)
						return { trail, ok: true, select: frame.options.map((o) => o.id) };
					await wire.request("provider.loginReply", { loginId, value: choice });
				} else {
					return { trail, ok: FIRST_USER_STEPS.has(frame.kind) };
				}
			}
		}
		trail.push(`TIMEOUT after ${FLOW_TIMEOUT_MS / 1000}s`);
		return { trail, ok: false };
	} finally {
		await wire.request("provider.loginCancel", { loginId }).catch(() => undefined);
	}
}

async function probeMethod(
	wire: Wire,
	providerId: string,
	type: "oauth" | "api_key",
	choices: string[] = [],
): Promise<Outcome[]> {
	const result = await runFlow(wire, providerId, type, choices);
	const flow = [providerId, type, ...choices].join(" › ");
	if (!result.select) return [{ flow, trail: result.trail, ok: result.ok }];
	if (choices.length >= MAX_SELECT_DEPTH) {
		return [{ flow, trail: [...result.trail, "nested choices too deep"], ok: false }];
	}
	const branches: Outcome[] = [];
	for (const option of result.select) {
		branches.push(...(await probeMethod(wire, providerId, type, [...choices, option])));
	}
	return branches;
}

const sandbox = mkdtempSync(join(tmpdir(), "thinkrail-smoke-logins-"));
for (const dir of ["data", "home", "pi-agent"]) mkdirSync(join(sandbox, dir));
const host = spawn("bun", ["--no-env-file", join(repoRoot, "packages/server/src/dev.ts")], {
	cwd: sandbox,
	env: {
		PATH: process.env.PATH ?? "",
		...toolHomeEnv(join(sandbox, "home")),
		THINKRAIL_PORT: "0",
		THINKRAIL_DATA_DIR: join(sandbox, "data"),
		PI_CODING_AGENT_DIR: join(sandbox, "pi-agent"),
		THINKRAIL_NO_ANALYTICS: "1",
	},
	stdio: ["ignore", "pipe", "ignore"],
});
const exited = new Promise<void>((resolve) => host.once("exit", () => resolve()));

function hostPort(): Promise<number> {
	return new Promise((resolve, reject) => {
		let output = "";
		const timer = setTimeout(() => reject(new Error("host did not come up")), BOOT_TIMEOUT_MS);
		host.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			const match = /thinkrail host: http:\/\/[^\s:]+:(\d+)/.exec(output);
			if (!match) return;
			clearTimeout(timer);
			resolve(Number(match[1]));
		});
		void exited.then(() => {
			clearTimeout(timer);
			reject(new Error("host exited before it came up"));
		});
	});
}

let failures = 0;
try {
	const wire = await Wire.connect(await hostPort());

	const report = await wire.request<ProviderStatusReport>("provider.status", {});
	const outcomes: Outcome[] = [];
	for (const provider of report.providers) {
		if (provider.kind === "central") continue;
		if (provider.canOAuth) outcomes.push(...(await probeMethod(wire, provider.id, "oauth")));
		if (provider.canApiKey) outcomes.push(...(await probeMethod(wire, provider.id, "api_key")));
	}
	wire.close();

	for (const outcome of outcomes) {
		console.log(`${outcome.ok ? "ok  " : "FAIL"}  ${outcome.flow}: ${outcome.trail.join(" → ")}`);
	}
	const failed = outcomes.filter((o) => !o.ok).length;
	failures = outcomes.length === 0 ? 1 : failed;
	console.log(
		`\nsmoke-provider-logins: ${outcomes.length - failed}/${outcomes.length} sign-in flows reached their first user step`,
	);
} finally {
	if (host.exitCode === null && host.signalCode === null) host.kill();
	await exited;
	rmSync(sandbox, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
