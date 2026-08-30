import type { UserMessage } from "@thinkrail/contracts";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

export const DOUBLE_CLICK_SETTLE_MS = 250;

export function tupleKey(namespace: string, ...parts: string[]): string {
	return `${namespace}:${parts.map((part) => `${part.length}:${part}`).join("")}`;
}

type LayoutResourceIdentityInput =
	| { kind: "file"; path: string }
	| {
			kind: "diff";
			path: string;
			scope:
				| { kind: "branch" | "uncommitted" }
				| { kind: "commit"; sha: string }
				| { kind: "pinned"; baseRef: string };
	  }
	| { kind: "chat"; sessionId: string }
	| { kind: "document"; documentKind: string; sourceId: string }
	| { kind: "terminal"; tabKey: string }
	| { kind: "tool"; tool: string };

export function layoutResourceIdentity<T extends LayoutResourceIdentityInput>(tab: T): string {
	switch (tab.kind) {
		case "file":
			return tupleKey("layout-resource", "file", tab.path);
		case "diff": {
			const reference =
				tab.scope.kind === "commit"
					? tab.scope.sha
					: tab.scope.kind === "pinned"
						? tab.scope.baseRef
						: "";
			return tupleKey("layout-resource", "diff", tab.path, tab.scope.kind, reference);
		}
		case "chat":
			return tupleKey("layout-resource", "chat", tab.sessionId);
		case "document":
			return tupleKey("layout-resource", "document", tab.documentKind, tab.sourceId);
		case "terminal":
			return tupleKey("layout-resource", "terminal", tab.tabKey);
		case "tool":
			return tupleKey("layout-resource", "tool", tab.tool);
	}
}

export function parseTupleKey(key: string, namespace: string): string[] | null {
	const prefix = `${namespace}:`;
	if (!key.startsWith(prefix)) return null;
	const parts: string[] = [];
	let offset = prefix.length;
	while (offset < key.length) {
		const separator = key.indexOf(":", offset);
		if (separator < 0) return null;
		const lengthText = key.slice(offset, separator);
		if (!/^(0|[1-9]\d*)$/.test(lengthText)) return null;
		const length = Number(lengthText);
		if (!Number.isSafeInteger(length)) return null;
		const start = separator + 1;
		const end = start + length;
		if (end > key.length) return null;
		parts.push(key.slice(start, end));
		offset = end;
	}
	return parts;
}

export function randomId(prefix = "id"): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${prefix}-${value}`;
}

export function userText(content: UserMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("");
}

export function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

export function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function isAbsolutePath(path: string): boolean {
	const normalized = normalizePath(path);
	return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

export function shallowEqualArrays(
	a: readonly unknown[] | undefined,
	b: readonly unknown[] | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	return a.every((value, i) => Object.is(value, b[i]));
}

function fileName(path: string): string {
	const parts = normalizePath(path).split("/").filter(Boolean);
	return parts.at(-1) ?? path;
}

function trimTrailingSlashes(path: string): string {
	return path === "/" || /^[A-Za-z]:\/$/.test(path) ? path : path.replace(/\/+$/, "");
}

function canonicalPosixPath(path: string): string {
	const normalized = normalizePath(path);
	const drive = /^[A-Za-z]:\//.exec(normalized)?.[0];
	const absolute = normalized.startsWith("/") || drive !== undefined;
	const body = drive ? normalized.slice(drive.length) : normalized.replace(/^\/+/, "");
	const segments: string[] = [];
	for (const segment of body.split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			const previous = segments.at(-1);
			if (previous && previous !== "..") segments.pop();
			else if (!absolute) segments.push(segment);
			continue;
		}
		segments.push(segment);
	}
	const prefix = drive ?? (absolute ? "/" : "");
	return `${prefix}${segments.join("/")}`;
}

export function projectRelativePath(path: string, workspaceRoot?: string | undefined): string {
	const canonical = canonicalPosixPath(path);
	if (!canonical || !isAbsolutePath(canonical)) return canonical;

	const root = workspaceRoot ? trimTrailingSlashes(canonicalPosixPath(workspaceRoot)) : "";
	const rootPrefix = root.endsWith("/") ? root : `${root}/`;
	if (root && (canonical === root || canonical.startsWith(rootPrefix))) {
		return canonical.slice(root.length).replace(/^\/+/, "") || fileName(canonical);
	}

	return canonical;
}

let colorCanvas: CanvasRenderingContext2D | null | undefined;

function canvasNormalize(color: string): string {
	if (typeof document === "undefined") return "";
	colorCanvas ??= document.createElement("canvas").getContext("2d");
	if (!colorCanvas) return "";
	colorCanvas.fillStyle = "#000000";
	colorCanvas.fillStyle = color;
	const first = colorCanvas.fillStyle;
	colorCanvas.fillStyle = "#ffffff";
	colorCanvas.fillStyle = color;
	return first === colorCanvas.fillStyle ? first : "";
}

export function cssColorToHex(color: string): string {
	const value = color.trim();
	const short = /^#([0-9a-f]{3,4})$/i.exec(value)?.[1];
	if (short) return `#${[...short].map((c) => c + c).join("")}`;
	if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value;
	const parsed = canvasNormalize(value);
	if (parsed.startsWith("#")) return parsed;
	const [, r, g, b, a] = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(parsed) ?? [];
	const channels = [Number(r), Number(g), Number(b), Math.round(Number(a) * 255)];
	if (channels.some((c) => !Number.isFinite(c))) return "";
	return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function stripFrontmatter(text: string): string {
	const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
	return match ? text.slice(match[0].length) : text;
}

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;

function browserPlatform(): string {
	return typeof navigator === "undefined" ? "" : (navigator.platform ?? "");
}

function isApplePlatform(platform: string): boolean {
	return APPLE_PLATFORM.test(platform);
}

export function hasPlatformModifier(
	event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">,
	platform = browserPlatform(),
): boolean {
	return isApplePlatform(platform)
		? event.metaKey && !event.ctrlKey
		: event.ctrlKey && !event.metaKey;
}

export function platformShortcutLabel(key: string, platform = browserPlatform()): string {
	return isApplePlatform(platform) ? `⌘${key}` : `Ctrl+${key}`;
}

export function relativeTime(ms: number): string {
	const s = Math.floor((Date.now() - ms) / 1000);
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
