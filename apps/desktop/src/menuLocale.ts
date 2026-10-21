/**
 * Language of the native application menu.
 *
 * The menu is built in the desktop process before the web client loads, so it cannot call the client's
 * translator. It reads the same persisted preference key the client writes (`thinkrail-locale`) and
 * resolves it by the same rule, falling back to the OS language and then to the build's default.
 *
 * The item labels Electron-style `role`s are handled by the platform, not by us, so `undo`/`copy`/… stay
 * with the OS; only the labels this app writes are translated here.
 */
import { readFileSync } from "node:fs";

export const MENU_LOCALES = ["en", "zh-CN"] as const;
export type MenuLocale = (typeof MENU_LOCALES)[number];

/** Must match `apps/web/src/i18n/locale.ts`. */
export const LOCALE_PREFERENCE_KEY = "thinkrail-locale";

/** Must match the client's `DEFAULT_LOCALE`. */
const DEFAULT_LOCALE: MenuLocale = "en";

/**
 * Label templates by locale. English is listed explicitly rather than relying on the key fallback so
 * `Quit` keeps its `{0}` placeholder — the product name is an argument, not part of the label, which is
 * what lets a translation put it elsewhere in the sentence.
 */
const LABELS: Record<MenuLocale, Record<string, string>> = {
	en: {
		Edit: "Edit",
		Window: "Window",
		Close: "Close",
		Quit: "Quit {0}",
		// The app menu's Settings item opens the in-app dialog, so it is ours to name.
		"Settings…": "Settings…",
		// The startup-failure dialog is the one other place the desktop process writes text, and it can
		// appear before the window exists — so it reads its language from the same table.
		"Could not start": "ThinkRail could not start",
		"Could not restart": "ThinkRail could not restart",
		"Could not restart to install the update": "ThinkRail could not restart to install the update",
		QuitApp: "Quit",
	},
	"zh-CN": {
		Edit: "编辑",
		Window: "窗口",
		Close: "关闭",
		Quit: "退出 {0}",
		"Settings…": "设置…",
		"Could not start": "ThinkRail 无法启动",
		"Could not restart": "ThinkRail 无法重启",
		"Could not restart to install the update": "ThinkRail 无法重启以安装更新",
		QuitApp: "退出",
	},
};

export function normalizeMenuLocale(tag: string | null | undefined): MenuLocale | null {
	if (!tag) return null;
	const lower = tag.toLowerCase();
	if (lower.startsWith("zh")) return "zh-CN";
	if (lower.startsWith("en")) return "en";
	return null;
}

/**
 * Read the persisted locale out of a desktop preference document. The client stores preferences as
 * encoded JSON strings under a per-window scope, so an unreadable or absent document simply means "no
 * explicit choice" rather than an error.
 */
export function localeFromPreferences(document: unknown, scopeKey?: string): MenuLocale | null {
	if (typeof document !== "object" || document === null) return null;
	const preferences = Reflect.get(document, "preferences");
	if (typeof preferences !== "object" || preferences === null) return null;
	const scopes = scopeKey !== undefined ? [scopeKey] : Object.keys(preferences);
	for (const scope of scopes) {
		const entries = Reflect.get(preferences, scope);
		if (typeof entries !== "object" || entries === null) continue;
		const raw = Reflect.get(entries, LOCALE_PREFERENCE_KEY);
		if (typeof raw !== "string") continue;
		const normalized = normalizeMenuLocale(raw);
		if (normalized) return normalized;
	}
	return null;
}

export function readLocalePreference(path: string, scopeKey?: string): MenuLocale | null {
	try {
		return localeFromPreferences(JSON.parse(readFileSync(path, "utf8")) as unknown, scopeKey);
	} catch {
		return null;
	}
}

export function resolveMenuLocale(
	preferencePath: string | undefined,
	scopeKey?: string,
): MenuLocale {
	const explicit =
		preferencePath === undefined ? null : readLocalePreference(preferencePath, scopeKey);
	if (explicit) return explicit;
	// `LANG`/`LC_ALL` are what a POSIX shell exports; Windows exposes the same intent through the
	// locale name, which Node surfaces in the same variables when it is set.
	const fromEnvironment = normalizeMenuLocale(process.env.LC_ALL ?? process.env.LANG ?? null);
	return fromEnvironment ?? DEFAULT_LOCALE;
}

/** Translate a desktop-process label. An unknown key falls back to the key, which is the English text. */
export function menuLabel(locale: MenuLocale, key: string, args?: readonly string[]): string {
	const template = LABELS[locale][key] ?? key;
	if (!args) return template;
	return template.replace(/\{(\d+)\}/g, (match, index: string) => args[Number(index)] ?? match);
}

export function menuLabels(locale: MenuLocale): Record<string, string> {
	return LABELS[locale];
}
