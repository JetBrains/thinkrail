import MonacoReact, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import {
	defineThinkrailTheme,
	EDITOR_THEME,
	sharedEditorOptions,
	watchThemeSwap,
} from "./monacoSetup";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

/** Read-only file viewer; language is inferred from `path`. Editing + save land with `fs.writeFile`. */
export default function MonacoEditor({ path, content }: { path: string; content: string }) {
	const stopThemeWatchRef = useRef<(() => void) | null>(null);

	// Follows atomic `[data-theme]` swaps while mounted, via the themes module's shared watcher.
	const onMount: OnMount = (_editor, m) => {
		stopThemeWatchRef.current = watchThemeSwap(m, EDITOR_THEME);
	};

	useEffect(() => () => stopThemeWatchRef.current?.(), []);

	return (
		<MonacoReact
			height="100%"
			path={path}
			value={content}
			theme={EDITOR_THEME}
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="flex h-full items-center justify-center text-text-muted">
					Loading editor…
				</div>
			}
			options={sharedEditorOptions()}
		/>
	);
}
