import { randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentToolResult,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { SpecIndex, type SpecType } from "../core/index.ts";

const indexes = new Map<string, SpecIndex>();

export function getIndex(root: string): SpecIndex {
	let index = indexes.get(root);
	if (!index) {
		index = new SpecIndex(root);
		indexes.set(root, index);
	}
	return index;
}

export async function textResult<T>(
	text: string,
	details: T,
	continuation = "",
): Promise<AgentToolResult<T>> {
	if (continuation) text += `\n${continuation}`;
	const preview = truncateHead(text);
	if (!preview.truncated) return { content: [{ type: "text", text }], details };
	let fullOutputPath: string | undefined;
	let ownedPath: string | undefined;
	let notice: string;
	try {
		const path = join(tmpdir(), `pi-spec-output-${randomUUID()}.txt`);
		const file = await open(path, "wx", 0o600);
		ownedPath = path;
		try {
			await file.writeFile(text);
		} finally {
			await file.close();
		}
		fullOutputPath = path;
		notice = `Full output saved to: ${path}\nTemporary file; may expire. Read only relevant offset/limit ranges; use shell byte ranges for oversized single lines.`;
	} catch {
		if (ownedPath) await unlink(ownedPath).catch(() => {});
		notice =
			"Full output unavailable: temporary-file capture failed. Narrow a read query; do not repeat a mutation to retrieve its output.";
	}
	const footer = `\n\n[Output truncated: ${preview.totalLines} lines, ${preview.totalBytes} bytes total. ${notice}]${continuation ? `\n${continuation}` : ""}`;
	const bounded = truncateHead(text, {
		maxBytes: Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(footer)),
		maxLines: DEFAULT_MAX_LINES - footer.split("\n").length,
	});
	return {
		content: [{ type: "text", text: `${bounded.content}${footer}` }],
		details: {
			...details,
			output: {
				truncated: true,
				...(fullOutputPath ? { fullOutputPath } : { captureFailed: true }),
			},
		},
	};
}

export async function errorResult(message: string): Promise<AgentToolResult<{ error: string }>> {
	return { ...(await textResult(`Error:\n${message}`, { error: message })), isError: true };
}

const SCAFFOLD_HEADINGS: Record<SpecType, string[]> = {
	"module-design": ["Responsibility", "Boundary"],
	"submodule-design": ["Responsibility", "Boundary"],
	"architecture-design": ["Drivers", "Decisions", "Invariants", "Out of scope"],
	"goal-and-requirements": ["Goal", "Scope"],
	"task-spec": ["Purpose", "Open items"],
};

export function scaffoldBody(type: SpecType): string {
	const headings = SCAFFOLD_HEADINGS[type];
	if (!headings || headings.length === 0) return "";
	return `${headings.map((h) => `## ${h}\n`).join("\n")}`;
}
