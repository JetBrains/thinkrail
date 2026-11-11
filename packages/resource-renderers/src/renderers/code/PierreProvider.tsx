import {
	canUseWASM,
	getCustomExtensionsVersion,
	preloadHighlighter,
	registerCustomTheme,
	replaceCustomExtensions,
} from "@pierre/diffs";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from "@pierre/diffs/worker";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type ResourceCodeHost, useResourceHost } from "../../host";
import { diffsFileTypes, editorLanguages } from "../../support/editorLanguages";

const POOL_SIZE = 4;
const THEME = "thinkrail";
const HIGHLIGHTER = "highlights";

let registered = false;
let highlighterFailed = false;

const PlainContext = createContext(false);

export function usePierrePlain(): boolean {
	return useContext(PlainContext);
}

function pierreWorkerPool({ pierreTheme, languages }: ResourceCodeHost): WorkerPoolManager {
	if (!registered) {
		registerCustomTheme(THEME, () => Promise.resolve(pierreTheme), "zed");
		replaceCustomExtensions(
			getCustomExtensionsVersion() + 1,
			diffsFileTypes(editorLanguages(languages)),
		);
		registered = true;
	}
	return getOrCreateWorkerPoolSingleton({
		poolOptions: {
			poolSize: POOL_SIZE,
			workerFactory: () =>
				new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
					type: "module",
				}),
		},
		highlighterOptions: {
			theme: THEME,
			lineDiffType: "word",
			preferredHighlighter: HIGHLIGHTER,
		},
	});
}

export default function PierreProvider({ children }: { children: ReactNode }) {
	const { code } = useResourceHost();
	const [plain, setPlain] = useState(() => highlighterFailed || !canUseWASM());
	const [pool] = useState(() => (plain ? undefined : pierreWorkerPool(code)));
	useEffect(() => {
		if (plain) return;
		let mounted = true;
		preloadHighlighter({
			themes: [THEME],
			langs: ["text"],
			preferredHighlighter: HIGHLIGHTER,
		}).catch(() => {
			highlighterFailed = true;
			if (mounted) setPlain(true);
		});
		return () => {
			mounted = false;
		};
	}, [plain]);
	return (
		<PlainContext.Provider value={plain}>
			<WorkerPoolContext.Provider value={pool}>{children}</WorkerPoolContext.Provider>
		</PlainContext.Provider>
	);
}
