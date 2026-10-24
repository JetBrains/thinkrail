import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoginFrame, LoginPush, ProviderStatusReport } from "@thinkrail/contracts";

const repoRoot = join(import.meta.dir, "..");
const FLOW_TIMEOUT_MS = 15_000;
const MAX_SELECT_DEPTH = 3;

interface Outcome {
	flow: string;
	trail: string[];
	ok: boolean;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, () => {
			const address = server.address();
			server.close(() =>
				typeof address === "object" && address
					? resolve(address.port)
					: reject(new Error("no port")),
			);
		});
	});
}

function describe(frame: LoginFrame): string {
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

class Wire {
	private seq = 0;
	private readonly replies = new Map<string, (m: { ok: boolean; result?: unknown }) => void>();
	readonly frames = new Map<string, LoginFrame[]>();

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id && this.replies.has(message.id)) {
				this.replies.get(message.id)?.(message);
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
		const reply = await new Promise<{ ok: boolean; result?: unknown }>((resolve) => {
			this.replies.set(id, resolve);
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
				trail.push(describe(frame));
				if (frame.kind === "select") {
					const choice = choices[picked++];
					if (choice === undefined)
						return { trail, ok: true, select: frame.options.map((o) => o.id) };
					await wire.request("provider.loginReply", { loginId, value: choice });
				} else {
					return { trail, ok: frame.kind !== "error" };
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
const port = await freePort();
const home = join(sandbox, "home");
const host = spawn("bun", [join(repoRoot, "packages/server/src/dev.ts")], {
	env: {
		PATH: process.env.PATH ?? "",
		HOME: home,
		THINKRAIL_PORT: String(port),
		THINKRAIL_DATA_DIR: join(sandbox, "data"),
		PI_CODING_AGENT_DIR: join(sandbox, "pi-agent"),
		CLAUDE_CONFIG_DIR: join(home, ".claude"),
		CODEX_HOME: join(home, ".codex"),
		GEMINI_CLI_HOME: home,
		THINKRAIL_NO_ANALYTICS: "1",
	},
	stdio: "ignore",
});

let failures = 0;
try {
	let wire: Wire | null = null;
	for (let attempt = 0; attempt < 60 && !wire; attempt++) {
		await Bun.sleep(500);
		wire = await Wire.connect(port).catch(() => null);
	}
	if (!wire) throw new Error(`host did not come up on port ${port}`);

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
	failures = outcomes.filter((o) => !o.ok).length;
	console.log(
		`\nsmoke-provider-logins: ${outcomes.length - failures}/${outcomes.length} sign-in flows reached their first user step`,
	);
} finally {
	host.kill();
	rmSync(sandbox, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
