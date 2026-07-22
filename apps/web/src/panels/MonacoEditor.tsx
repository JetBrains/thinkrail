import MonacoReact, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { defineThinkrailTheme, THEME, watchThemeSwap } from "./monacoSetup";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

/** Read-only file viewer; language is inferred from `path`. Editing + save land with `fs.writeFile`. */
export default function MonacoEditor({ path, content }: { path: string; content: string }) {
	const observerRef = useRef<MutationObserver | null>(null);

	// Mirrors TerminalInstance's observer: follow atomic `[data-theme]` swaps while mounted.
	const onMount: OnMount = (_editor, m) => {
		observerRef.current = watchThemeSwap(m);
	};

	useEffect(() => () => observerRef.current?.disconnect(), []);

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
				readOnly: true,
				minimap: { enabled: false },
				fontSize: 13,
				scrollBeyondLastLine: false,
				automaticLayout: true,
			}}
		/>
	);
}
