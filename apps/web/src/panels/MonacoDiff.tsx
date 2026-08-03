import {
	type BeforeMount,
	DiffEditor,
	type DiffOnMount,
	type MonacoDiffEditor,
} from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import {
	defineThinkrailTheme,
	languageForPath,
	sharedEditorOptions,
	THEME,
	watchThemeSwap,
} from "./monacoSetup";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

/**
 * Read-only Monaco diff of one file: the diff scope's original side vs its modified side. `view` picks split
 * (side-by-side) or inline rendering; `ignoreWhitespace` drops whitespace-only changes. Language is inferred
 * from the model paths (both derive from the file's own path, so both sides highlight alike).
 */
export default function MonacoDiff({
	path,
	original,
	modified,
	view,
	ignoreWhitespace,
}: {
	path: string;
	original: string;
	modified: string;
	view: "split" | "inline";
	ignoreWhitespace: boolean;
}) {
	const observerRef = useRef<MutationObserver | null>(null);
	// The diff widget + its two TextModels, captured at mount so our unmount cleanup can dispose them in the
	// right order — see below.
	const editorRef = useRef<MonacoDiffEditor | null>(null);
	const modelsRef = useRef<{ dispose(): void }[]>([]);

	// Mirrors MonacoEditor's observer: follow atomic `[data-theme]` swaps while mounted.
	const onMount: DiffOnMount = (editor, m) => {
		observerRef.current = watchThemeSwap(m);
		editorRef.current = editor;
		const model = editor.getModel();
		modelsRef.current = model ? [model.original, model.modified] : [];
	};

	useEffect(
		() => () => {
			observerRef.current?.disconnect();
			// Dispose the diff *widget* before its TextModels. Disposing a model while a live widget still
			// references it trips Monaco 0.52+'s "TextModel got disposed before DiffEditorWidget model got
			// reset" assertion (@monaco-editor/react#647 / monaco-editor#4779, unfixed in 4.7.0), and
			// `@monaco-editor/react`'s own cleanup disposes them in the wrong order. The `keepCurrent*` flags
			// below stop it from disposing the models early, so we own their lifecycle here and free them only
			// after the widget is gone (widget dispose is idempotent, so it's fine if the library already ran).
			// Not keeping them would also leak a model pair per closed diff tab.
			editorRef.current?.dispose();
			editorRef.current = null;
			for (const model of modelsRef.current) model.dispose();
			modelsRef.current = [];
		},
		[],
	);

	return (
		<DiffEditor
			height="100%"
			original={original}
			modified={modified}
			language={languageForPath(path)}
			originalModelPath={`diff-original://${path}`}
			modifiedModelPath={`diff-modified://${path}`}
			theme={THEME}
			// Keep the models on unmount so `DiffEditor` disposes the widget *before* its models (it otherwise
			// disposes models first — the assertion trip above); we free them ourselves once the widget is gone.
			keepCurrentOriginalModel
			keepCurrentModifiedModel
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="flex h-full items-center justify-center text-text-subtle">
					Loading diff…
				</div>
			}
			// `useInlineViewWhenSpaceIsLimited: false`: the pane-header toggle must do what it says — without
			// it Monaco silently renders Split as inline on a narrow pane, which reads as a broken toggle.
			options={{
				...sharedEditorOptions(),
				renderSideBySide: view === "split",
				useInlineViewWhenSpaceIsLimited: false,
				// Collapsed unchanged context ("N unmodified lines", with an expand control) is Monaco's own
				// feature in both split and inline — nothing hand-rolled to keep in sync with its folding.
				hideUnchangedRegions: { enabled: true },
				ignoreTrimWhitespace: ignoreWhitespace,
			}}
		/>
	);
}
