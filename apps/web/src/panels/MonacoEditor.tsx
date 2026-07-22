import MonacoReact, {
	type BeforeMount,
	loader,
	type Monaco,
	type OnMount,
} from "@monaco-editor/react";
import type { Environment } from "monaco-editor";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { useEffect, useRef } from "react";
import { cssColorToHex } from "@/lib";

declare global {
	interface Window {
		MonacoEnvironment?: Environment;
	}
}

// Monaco's web workers, wired through Vite. Without this Monaco drops to the main thread and breaks
// language features — the #1 Monaco-under-Vite gotcha.
window.MonacoEnvironment = {
	getWorker(_workerId, label) {
		if (label === "json") return new jsonWorker();
		if (label === "css" || label === "scss" || label === "less") return new cssWorker();
		if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
		if (label === "typescript" || label === "javascript") return new tsWorker();
		return new editorWorker();
	},
};

// Use the locally-bundled Monaco instead of the loader's CDN default — keeps the app self-contained.
loader.config({ monaco });

/** The one Monaco theme id — shared by the file viewer and `DiffPane` (both define it from the live
 * CSS tokens via `defineThinkrailTheme`). */
export const THEME = "thinkrail";

/** Read a CSS custom property off the document root, so Monaco's chrome tracks the active theme tokens.
 * Canonicalized to hex: the built CSS is minified (`#ffffff` → `#fff`, `#808080` → `gray`), and Monaco
 * accepts only hex — an unparseable value reads as unset (`""`) and is dropped by the callers. */
function token(name: string): string {
	return cssColorToHex(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/** Monaco token name → the `--code-*` syntax token a theme may set (Darcula/Gruvbox set full
 * palettes; High Contrast only the comment pair — the rest rides its hc-black base). */
const SYNTAX_TOKENS: [string, string][] = [
	["keyword", "--code-keyword"],
	["string", "--code-string"],
	["comment", "--code-comment"],
	["comment.doc", "--code-comment-doc"],
	["number", "--code-number"],
	["regexp", "--code-regexp"],
	["annotation", "--code-annotation"],
	["tag", "--code-tag"],
	["attribute.name", "--code-attribute-name"],
	["attribute.value", "--code-attribute-value"],
	["string.key.json", "--code-json-key"],
];

/** Define (or redefine) the thinkrail Monaco theme from the live CSS tokens: chrome colors from the
 * surface tokens, the per-theme built-in base (`vs`/`vs-dark`/`hc-black`) from the active `[data-theme]`, and syntax rules from whichever
 * `--code-*` tokens the theme sets. Called before mount and again on every theme swap. */
export function defineThinkrailTheme(m: Monaco): void {
	const colors: Record<string, string> = {};
	const set = (key: string, value: string) => {
		if (value) colors[key] = value;
	};
	set("editor.background", token("--surface-content"));
	set("editor.foreground", token("--text"));
	set("editorLineNumber.foreground", token("--hint"));
	set("editorCursor.foreground", token("--primary"));
	set("editor.selectionBackground", token("--sel"));
	// Optional selected-text color (high-contrast: black on the yellow selection); unset → base default.
	set("editor.selectionForeground", token("--sel-fg"));
	const rules = SYNTAX_TOKENS.flatMap(([monacoToken, name]) => {
		const color = token(name);
		return color ? [{ token: monacoToken, foreground: color.replace("#", "") }] : [];
	});
	// Per-theme built-in base: `hc-black` IS the classical VSCode HC syntax palette (white numbers,
	// #569cd6 keywords, #1aebff variables), which is why the high-contrast theme sets no `--code-*`
	// beyond the comment green.
	const dataTheme = document.documentElement.dataset.theme;
	const base =
		dataTheme === "light" ? "vs" : dataTheme === "high-contrast" ? "hc-black" : "vs-dark";
	try {
		m.editor.defineTheme(THEME, { base, inherit: true, rules, colors });
	} catch {
		// A token value Monaco can't parse must degrade to the base palette, never crash the panel.
		m.editor.defineTheme(THEME, { base, inherit: true, rules: [], colors: {} });
	}
}

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

/** Re-theme Monaco on a `[data-theme]` swap: chrome + base are read once at define time, so without
 * this an editor keeps the theme it mounted with. Shared by the file viewer and `DiffPane`; the
 * caller disconnects the returned observer on unmount. Mirrors TerminalInstance's observer. */
export function observeThemeSwap(m: Monaco): MutationObserver {
	const observer = new MutationObserver(() => {
		defineThinkrailTheme(m);
		m.editor.setTheme(THEME);
	});
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return observer;
}

/** File viewer; language is inferred from `path`. Read-only by default (the transcript/file-tab viewer);
 * pass `readOnly={false}` to allow inline editing. `onReadOnlyEdit` fires when the user tries to type
 * while read-only (Monaco's `onDidAttemptReadonlyEdit`) — used to surface a soft-edit hint. */
export default function MonacoEditor({
	path,
	content,
	readOnly = true,
	onReadOnlyEdit,
}: {
	path: string;
	content: string;
	readOnly?: boolean;
	onReadOnlyEdit?: () => void;
}) {
	const observerRef = useRef<MutationObserver | null>(null);
	const editRef = useRef<{ dispose: () => void } | null>(null);

	const onMount: OnMount = (editor, m) => {
		observerRef.current = observeThemeSwap(m);
		// A keystroke in a read-only editor fires this instead of being silently swallowed.
		editRef.current = editor.onDidAttemptReadOnlyEdit(() => onReadOnlyEdit?.());
	};

	useEffect(
		() => () => {
			observerRef.current?.disconnect();
			editRef.current?.dispose();
		},
		[],
	);

	return (
		<MonacoReact
			height="100%"
			path={path}
			value={content}
			theme={THEME}
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="flex h-full items-center justify-center text-hint">Loading editor…</div>
			}
			options={{
				readOnly,
				minimap: { enabled: false },
				fontSize: 13,
				scrollBeyondLastLine: false,
				automaticLayout: true,
			}}
		/>
	);
}
