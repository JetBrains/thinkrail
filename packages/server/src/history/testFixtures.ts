import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function writeFixtureSession(
	dir: string,
	opts: {
		id?: string;
		cwd: string;
		name?: string;
		messages: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>;
	},
): { id: string; path: string } {
	mkdirSync(dir, { recursive: true });

	const sessionId = opts.id ?? `sess-${randomUUID()}`;
	const entryId = (suffix: string) => `${sessionId}-${suffix}`;
	let parentId: string | null = null;
	const lines: string[] = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: sessionId,
			timestamp: new Date(opts.messages[0]?.timestamp ?? Date.now()).toISOString(),
			cwd: opts.cwd,
		}),
	];

	if (opts.name !== undefined) {
		const id = entryId("info");
		lines.push(
			JSON.stringify({
				type: "session_info",
				id,
				parentId,
				timestamp: new Date().toISOString(),
				name: opts.name,
			}),
		);
		parentId = id;
	}

	opts.messages.forEach((m, i) => {
		const id = entryId(`m${i}`);
		const content = m.role === "assistant" ? [{ type: "text", text: m.text }] : m.text;
		lines.push(
			JSON.stringify({
				type: "message",
				id,
				parentId,
				timestamp: new Date(m.timestamp).toISOString(),
				message: { role: m.role, content, timestamp: m.timestamp },
			}),
		);
		parentId = id;
	});

	const path = join(dir, `${opts.messages[0]?.timestamp ?? Date.now()}_${sessionId}.jsonl`);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return { id: sessionId, path };
}

export function defaultSessionDirFor(agentDir: string, cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const resolvedAgentDir = resolve(agentDir);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolvedAgentDir, "sessions", safePath);
}
