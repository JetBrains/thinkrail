import type { UserMessage } from "@thinkrail/contracts";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names and de-dupe conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** A user message's plain text (ignores image parts) — shared by transcript hydration, the store's
 * live event fold, and the transcript renderer, so "same message" means the same thing everywhere. It
 * lives here (not in `chat/`) because `store` needs it too and its edge to `chat/` is type-only. */
export function userText(content: UserMessage["content"]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("");
}

/** True for a markdown file path (`.md` / `.markdown`, case-insensitive) — the rendered-preview gate. */
export function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

/**
 * One canonical form for a path: `/` separators and no leading `./`. Every path the app compares or displays
 * arrives from a pi tool call or the host, either of which may use the platform's separator and may prefix a
 * relative path with `./` — so normalizing is the first step of any path predicate here, and it lives once
 * for all of them. The `./` strip matters to *comparison*, not just display: without it a reported
 * `./src/foo.ts` matches neither the entry `src/foo.ts` nor any spec-graph node.
 */
export function normalizePath(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

/** Posix or Windows absolute path — the two forms a tool call's `path` argument can arrive in. */
export function isAbsolutePath(path: string): boolean {
	const normalized = normalizePath(path);
	return normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
}

/**
 * Element-wise (`Object.is`) equality of two arrays — the "did this really change?" test shared by the
 * places that must not treat an equal-but-new array as a change (a re-read's snapshot, an `ErrorBoundary`'s
 * reset keys). `Object.is` rather than `===` so `NaN` keys compare equal to themselves.
 */
export function shallowEqualArrays(
	a: readonly unknown[] | undefined,
	b: readonly unknown[] | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	return a.every((value, i) => Object.is(value, b[i]));
}

/** The last path segment, e.g. "/a/b/App.tsx" -> "App.tsx". */
function fileName(path: string): string {
	const parts = normalizePath(path).split("/").filter(Boolean);
	return parts.at(-1) ?? path;
}

function trimTrailingSlashes(path: string): string {
	return path.replace(/\/+$/, "");
}

/**
 * A file path as the app addresses it: **worktree-relative** when the given root matches, else the
 * normalized input. Tool args may already be relative; absolute ones are trimmed only when the
 * host-provided root prefixes them.
 *
 * This is both the display form (tool cards, the turn divider's artifact list) and the **tab identity**
 * (`openFileInTab` keys tabs by it), so one file can never end up under two ids — which is why it belongs
 * here rather than in any one consumer.
 */
export function projectRelativePath(path: string, workspaceRoot?: string | undefined): string {
	const normalized = normalizePath(path); // already strips a leading `./`
	if (!normalized || !isAbsolutePath(normalized)) return normalized;

	const root = workspaceRoot ? trimTrailingSlashes(normalizePath(workspaceRoot)) : "";
	if (root && (normalized === root || normalized.startsWith(`${root}/`))) {
		return normalized.slice(root.length).replace(/^\/+/, "") || fileName(normalized);
	}

	return normalized;
}

let colorCanvas: CanvasRenderingContext2D | null | undefined;

function canvasNormalize(color: string): string {
	if (typeof document === "undefined") return "";
	colorCanvas ??= document.createElement("canvas").getContext("2d");
	if (!colorCanvas) return "";
	// An invalid assignment leaves fillStyle unchanged, so two different priors agreeing means `color`
	// really parsed (and a canvas serializes it canonically: `#rrggbb`, or `rgba()` when it has alpha).
	colorCanvas.fillStyle = "#000000";
	colorCanvas.fillStyle = color;
	const first = colorCanvas.fillStyle;
	colorCanvas.fillStyle = "#ffffff";
	colorCanvas.fillStyle = color;
	return first === colorCanvas.fillStyle ? first : "";
}

/**
 * Canonicalize a CSS color to hex (`#rrggbb`/`#rrggbbaa`), or `""` when it can't be parsed. The built CSS
 * is minified, so a token read via `getComputedStyle` can come back in ANY equivalent form (`#fff`,
 * `gray`, `rgb(…)`) — and strict consumers (Monaco's theme colors, xterm's palette) only accept hex.
 * Non-hex forms round-trip through a canvas, which serializes solid colors to `#rrggbb` and alpha colors
 * to `rgba()` (converted here).
 */
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

/**
 * Drop a leading YAML frontmatter block (a `---` line, its body, and a closing `---`/`...` line) so the
 * rendered markdown view doesn't turn spec metadata into a stray heading — the conventional behavior for
 * rendered markdown (source view still shows it). No frontmatter → returned unchanged.
 */
export function stripFrontmatter(text: string): string {
	const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
	return match ? text.slice(match[0].length) : text;
}

const APPLE_PLATFORM = /Mac|iPhone|iPad|iPod/;

function isApplePlatform(): boolean {
	return typeof navigator !== "undefined" && APPLE_PLATFORM.test(navigator.platform ?? "");
}

/** The platform's primary application modifier: Cmd on Apple devices, Ctrl everywhere else. */
export function hasPlatformModifier(event: Pick<KeyboardEvent, "ctrlKey" | "metaKey">): boolean {
	return isApplePlatform() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Human-readable primary-modifier shortcut, kept in lockstep with `hasPlatformModifier`. */
export function platformShortcutLabel(key: string): string {
	return isApplePlatform() ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * Tiny relative-time formatter (`just now` / `5m ago` / `3h ago` / `2d ago`) — shared by every "when did
 * this happen" line (chat history, the tab strip's closed chats, the Changes scope menu's commits) so they
 * all read alike. Lives here because `chat/` may not import from `panels/`.
 */
export function relativeTime(ms: number): string {
	const s = Math.floor((Date.now() - ms) / 1000);
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

/**
 * Copy text to the clipboard, reporting whether it landed. One helper because the *degradation* is the
 * point: an insecure context (plain-http remote access) or a denied permission has no clipboard, and every
 * caller's answer is the same — do nothing loud, the text stays selectable/visible.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
