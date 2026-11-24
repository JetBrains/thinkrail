import { type CompactAgeUnit, compactAgeOf } from "@thinkrail/contracts";
import { EN, type MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import { browserPlatform, isApplePlatform } from "@thinkrail/ui/keyboard";

export const DOUBLE_CLICK_SETTLE_MS = 250;

let lastFirstClickAt = Number.NEGATIVE_INFINITY;

export function firstClickOnly<E extends { detail: number }>(
	run: (event: E) => void,
	now: () => number = () => performance.now(),
): (event: E) => void {
	return (event) => {
		if (event.detail > 1) return;
		if (event.detail === 1) lastFirstClickAt = now();
		run(event);
	};
}

export function doubleClickPendingMs(now = performance.now()): number {
	return Math.max(0, DOUBLE_CLICK_SETTLE_MS - (now - lastFirstClickAt));
}

export function tupleKey(namespace: string, ...parts: string[]): string {
	return `${namespace}:${parts.map((part) => `${part.length}:${part}`).join("")}`;
}

type LayoutDiffScopeInput =
	| { kind: "branch" | "uncommitted" }
	| { kind: "commit"; sha: string }
	| { kind: "pinned"; baseRef: string }
	| { kind: "turn"; id: string };

type LayoutResourceIdentityInput =
	| { kind: "file"; path: string }
	| { kind: "diff"; path: string; before?: undefined; scope: LayoutDiffScopeInput }
	| { kind: "diff"; path: string; before: string }
	| { kind: "changes"; scope: LayoutDiffScopeInput }
	| { kind: "chat"; sessionId: string }
	| { kind: "document"; documentKind: string; sourceId: string }
	| { kind: "terminal"; tabKey: string }
	| { kind: "tool"; tool: string }
	| {
			kind: "extension";
			extension: string;
			panel: string;
			params: Readonly<Record<string, string>>;
	  };

export function extensionParamsKey(params: Readonly<Record<string, string>>): string {
	return tupleKey(
		"params",
		...Object.keys(params)
			.sort()
			.flatMap((key) => [key, params[key] ?? ""]),
	);
}

export function isMessageKey(key: string): key is MessageKey {
	return Object.hasOwn(EN, key) || Object.hasOwn(EN, `${key}_other`);
}

function layoutScopeReference(scope: LayoutDiffScopeInput): string {
	switch (scope.kind) {
		case "commit":
			return scope.sha;
		case "pinned":
			return scope.baseRef;
		case "turn":
			return scope.id;
		default:
			return "";
	}
}

export function isPreviewCompatibleTabKind(kind: string): boolean {
	return kind === "file" || kind === "diff" || kind === "changes";
}

export function layoutResourceIdentity<T extends LayoutResourceIdentityInput>(tab: T): string {
	switch (tab.kind) {
		case "file":
			return tupleKey("layout-resource", "file", tab.path);
		case "diff":
			return tab.before === undefined
				? tupleKey(
						"layout-resource",
						"diff",
						tab.path,
						tab.scope.kind,
						layoutScopeReference(tab.scope),
					)
				: tupleKey("layout-resource", "compare", tab.before, tab.path);
		case "changes":
			return tupleKey(
				"layout-resource",
				"changes",
				tab.scope.kind,
				layoutScopeReference(tab.scope),
			);
		case "chat":
			return tupleKey("layout-resource", "chat", tab.sessionId);
		case "document":
			return tupleKey("layout-resource", "document", tab.documentKind, tab.sourceId);
		case "terminal":
			return tupleKey("layout-resource", "terminal", tab.tabKey);
		case "tool":
			return tupleKey("layout-resource", "tool", tab.tool);
		case "extension":
			return tupleKey(
				"layout-resource",
				"extension",
				tab.extension,
				tab.panel,
				extensionParamsKey(tab.params),
			);
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

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ancestorPaths(path: string): string[] {
	const segments = path.split("/");
	segments.pop();
	return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

export function shallowEqualArrays(
	a: readonly unknown[] | undefined,
	b: readonly unknown[] | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	return a.every((value, i) => Object.is(value, b[i]));
}

export { hasPlatformModifier } from "@thinkrail/ui/keyboard";
export { cssColorToHex } from "@thinkrail/ui/theme";

export function platformFamily(platform = browserPlatform()) {
	if (isApplePlatform(platform)) return "apple";
	if (/^Win/.test(platform)) return "windows";
	if (/Linux/.test(platform)) return "linux";
	return "other";
}

export function platformShortcutLabel(
	key: string,
	{ alt = false, platform = browserPlatform() }: { alt?: boolean; platform?: string } = {},
): string {
	if (isApplePlatform(platform)) return alt ? `⌥⌘${key}` : `⌘${key}`;
	return alt ? `Ctrl+Alt+${key}` : `Ctrl+${key}`;
}

export function relativeTime(t: Translator, ms: number, now: number): string {
	const s = Math.floor((now - ms) / 1000);
	if (s < 60) return t("lib.relativeTime.justNow");
	const m = Math.floor(s / 60);
	if (m < 60) return t("lib.relativeTime.minutes", { count: m });
	const h = Math.floor(m / 60);
	if (h < 24) return t("lib.relativeTime.hours", { count: h });
	return t("lib.relativeTime.days", { count: Math.floor(h / 24) });
}

/** Compact elapsed label for dense rows: `3h`, `12d`, `3w`, `4mo`. */
export function compactAge(t: Translator, ms: number, now: number): string {
	const { unit, count } = compactAgeOf(ms, now);
	return t(COMPACT_AGE_KEYS[unit], { count });
}

const COMPACT_AGE_KEYS = {
	underHour: "lib.compactAge.underHour",
	hours: "lib.compactAge.hours",
	days: "lib.compactAge.days",
	weeks: "lib.compactAge.weeks",
	months: "lib.compactAge.months",
} as const satisfies Record<CompactAgeUnit, string>;

export function isShellInert(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value);
}

export const MODAL_LAYER_SELECTOR = [
	'[aria-modal="true"]',
	'[role="dialog"][data-state="open"]',
	'[role="alertdialog"][data-state="open"]',
].join(", ");

export function hasLayer(root: Pick<Document, "querySelector">, selector: string): boolean {
	return root.querySelector(selector) !== null;
}

const TEXT_ENTRY_ROOT_SELECTOR = ".monaco-editor, .xterm";
export const READ_ONLY_TEXT_SELECTOR = '[data-text-entry="false"]';

export function isTextEntryTarget(target: EventTarget | null): boolean {
	const element = target as {
		isContentEditable?: boolean;
		tagName?: string;
		closest?: (selector: string) => Element | null;
	} | null;
	if (element === null) return false;
	const within = (selector: string) =>
		typeof element.closest === "function" && element.closest(selector) !== null;
	if (within(READ_ONLY_TEXT_SELECTOR)) return false;
	return (
		element.isContentEditable === true ||
		/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName ?? "") ||
		within(TEXT_ENTRY_ROOT_SELECTOR)
	);
}
