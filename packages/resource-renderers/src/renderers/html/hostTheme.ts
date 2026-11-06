import { onFontsChange } from "@thinkrail/ui/fonts";
import { onThemeSwap } from "@thinkrail/ui/theme";

const FRAME_BASE =
	":where(html){background:var(--container-workspace-bg);color:var(--text-default);" +
	"font-family:var(--tr-font-family-interface);font-size:var(--tr-font-size-s13)}";

interface RuleLike {
	selectorText?: string;
	style?: CSSStyleDeclaration;
	cssRules?: CSSRuleList;
}

function declaredNames(style: CSSStyleDeclaration, into: Set<string>): void {
	for (let index = 0; index < style.length; index += 1) {
		const name = style.item(index);
		if (name.startsWith("--")) into.add(name);
	}
}

function rulesOf(container: { cssRules?: CSSRuleList }): readonly RuleLike[] {
	try {
		return container.cssRules ? (Array.from(container.cssRules) as RuleLike[]) : [];
	} catch {
		return [];
	}
}

function collectRootNames(rules: readonly RuleLike[], into: Set<string>): void {
	for (const rule of rules) {
		if (rule.style && rule.selectorText?.includes(":root")) declaredNames(rule.style, into);
		collectRootNames(rulesOf(rule), into);
	}
}

export function rootCustomPropertyNames(root: HTMLElement, sheets: Iterable<CSSStyleSheet>) {
	const names = new Set<string>();
	for (const sheet of sheets) collectRootNames(rulesOf(sheet), names);
	declaredNames(root.style, names);
	return [...names].sort();
}

export function themeCss({
	names,
	value,
	colorScheme,
}: {
	names: readonly string[];
	value: (name: string) => string;
	colorScheme: string;
}): string {
	const declarations = names.flatMap((name) => {
		const resolved = value(name).trim();
		return resolved === "" ? [] : [`${name}:${resolved};`];
	});
	return `:root{color-scheme:${colorScheme || "normal"};${declarations.join("")}}${FRAME_BASE}`;
}

export function readHostThemeCss(): string {
	if (typeof document === "undefined") return "";
	const root = document.documentElement;
	const computed = getComputedStyle(root);
	return themeCss({
		names: rootCustomPropertyNames(root, Array.from(document.styleSheets)),
		value: (name) => computed.getPropertyValue(name),
		colorScheme: computed.colorScheme || root.style.colorScheme,
	});
}

const listeners = new Set<() => void>();
let cached: string | null = null;
let stopWatching: (() => void) | null = null;

function refresh(): void {
	cached = readHostThemeCss();
	for (const listener of listeners) listener();
}

export function subscribeHostTheme(listener: () => void): () => void {
	listeners.add(listener);
	if (!stopWatching) {
		const stopTheme = onThemeSwap(refresh);
		const stopFonts = onFontsChange(refresh);
		stopWatching = () => {
			stopTheme();
			stopFonts();
		};
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size > 0) return;
		stopWatching?.();
		stopWatching = null;
		cached = null;
	};
}

export function hostThemeSnapshot(): string {
	if (listeners.size === 0) return readHostThemeCss();
	cached ??= readHostThemeCss();
	return cached;
}

export const serverThemeSnapshot = () => "";
