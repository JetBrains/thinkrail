import type { ArtifactRole, ArtifactRoleReason } from "@thinkrail/contracts";

export type Presented = "shown" | "linked";

export interface ArtifactSignals {
	presented?: Presented;
	picked?: true;
	published?: true;
}

const WORKING_FOLDERS = new Set([
	"bin",
	"build",
	"check",
	"comments",
	"css",
	"data",
	"extract",
	"fonts",
	"frames",
	"images",
	"js",
	"previews",
	"raw",
	"scripts",
	"src",
	"tools",
]);
const SCRIPT = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|sh)$/i;
const DATA = /\.(?:json|jsonl|txt|tsv|csv|log|patch)$/i;

function workingFolder(segment: string): boolean {
	return (
		segment.startsWith("_") ||
		segment.startsWith(".") ||
		WORKING_FOLDERS.has(segment) ||
		segment.startsWith("batch_") ||
		segment.startsWith("notes")
	);
}

export function artifactRole(
	pathInArtifacts: string,
	signals: ArtifactSignals,
): { role: ArtifactRole; reason: ArtifactRoleReason } {
	if (signals.published) return { role: "result", reason: "published" };
	if (signals.picked) return { role: "result", reason: "picked" };
	if (signals.presented) return { role: "result", reason: signals.presented };
	const segments = pathInArtifacts.split("/");
	const name = segments.pop() ?? "";
	if (segments.some(workingFolder)) return { role: "working", reason: "working-folder" };
	if (SCRIPT.test(name)) return { role: "working", reason: "script" };
	if (DATA.test(name) || !name.includes(".")) return { role: "working", reason: "data" };
	return { role: "working", reason: "unshown" };
}

const MARKDOWN_TARGET = /\]\(\s*<?([^)>]+?)>?\s*\)/g;
const CODE_SPAN = /`([^`\n]+)`/g;
const TRAILING = /[.,;:!?)\]}>'"»]+$/;
const LEADING = /^[([{<'"«]+/;

function decode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function replyPathCandidates(text: string): string[] {
	const raw: string[] = [];
	for (const match of text.matchAll(MARKDOWN_TARGET)) if (match[1]) raw.push(match[1]);
	for (const match of text.matchAll(CODE_SPAN)) if (match[1]) raw.push(match[1]);
	for (const token of text.split(/[\s`*]+/)) raw.push(token);
	const out = new Set<string>();
	for (const item of raw) {
		let value = decode(item.trim()).replace(LEADING, "").replace(TRAILING, "");
		if (value.startsWith("file://")) value = value.slice("file://".length);
		if (value.startsWith("@")) value = value.slice(1);
		if (value.startsWith("./")) value = value.slice(2);
		value = value.replace(/#.*$/, "");
		if (value) out.add(value);
	}
	return [...out];
}
