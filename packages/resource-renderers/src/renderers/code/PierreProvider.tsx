import { canUseWASM, preloadHighlighter, registerCustomTheme } from "@pierre/diffs";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from "@pierre/diffs/worker";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type ResourceCodeHost, useResourceHost } from "../../host";

const POOL_SIZE = 4;
const THEME = "thinkrail";
const HIGHLIGHTER = "highlights";

let themeRegistered = false;
let highlighterFailed = false;

const PlainContext = createContext(false);

export function usePierrePlain(): boolean {
	return useContext(PlainContext);
}

function pierreWorkerPool(theme: ResourceCodeHost["pierreTheme"]): WorkerPoolManager {
	if (!themeRegistered) {
		registerCustomTheme(THEME, () => Promise.resolve(theme), "zed");
		themeRegistered = true;
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
	const { pierreTheme } = useResourceHost().code;
	const [plain, setPlain] = useState(() => highlighterFailed || !canUseWASM());
	const [pool] = useState(() => (plain ? undefined : pierreWorkerPool(pierreTheme)));
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
