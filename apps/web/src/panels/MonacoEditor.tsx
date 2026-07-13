import MonacoReact, { type BeforeMount, loader } from "@monaco-editor/react";
import type { Environment } from "monaco-editor";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { useState } from "react";
import { useMonacoInlineEdit } from "@/inline-edit";

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

const THEME = "thinkrail";

/** Read a CSS custom property off the document root, so Monaco's chrome tracks the active theme tokens. */
function token(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const defineThinkrailTheme: BeforeMount = (m) => {
	const colors: Record<string, string> = {};
	const set = (key: string, value: string) => {
		if (value) colors[key] = value;
	};
	set("editor.background", token("--surface-content"));
	set("editor.foreground", token("--text"));
	set("editorLineNumber.foreground", token("--hint"));
	set("editorCursor.foreground", token("--primary"));
	set("editor.selectionBackground", token("--sel"));
	m.editor.defineTheme(THEME, { base: "vs-dark", inherit: true, rules: [], colors });
};

/**
 * Read-only file viewer; language is inferred from `path`. Editing + save land with `fs.writeFile`. Also
 * hosts inline AI-editing (`useMonacoInlineEdit`): the editor instance is captured via `onMount` so the
 * controller can read selections and place its overlay (pill/popup/chip/review card) in the wrapping
 * `relative` container.
 */
export default function MonacoEditor({
	path,
	content,
	workspaceId,
}: {
	path: string;
	content: string;
	workspaceId: string;
}) {
	const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
	const { overlay } = useMonacoInlineEdit({ editor, workspaceId, path });
	return (
		<div className="relative h-full">
			<MonacoReact
				height="100%"
				path={path}
				value={content}
				theme={THEME}
				beforeMount={defineThinkrailTheme}
				onMount={(ed) => setEditor(ed)}
				loading={
					<div className="flex h-full items-center justify-center text-hint">Loading editor…</div>
				}
				options={{
					readOnly: true,
					minimap: { enabled: false },
					fontSize: 13,
					scrollBeyondLastLine: false,
					automaticLayout: true,
				}}
			/>
			{overlay}
		</div>
	);
}
