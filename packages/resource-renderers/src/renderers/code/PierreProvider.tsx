import { registerCustomTheme } from "@pierre/diffs";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from "@pierre/diffs/worker";
import { type ReactNode, useState } from "react";
import { type ResourceCodeHost, useResourceHost } from "../../host";

const POOL_SIZE = 4;

let themeRegistered = false;

function pierreWorkerPool(theme: ResourceCodeHost["pierreTheme"]): WorkerPoolManager {
	if (!themeRegistered) {
		registerCustomTheme("thinkrail", () => Promise.resolve(theme), "zed");
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
			theme: "thinkrail",
			lineDiffType: "word",
			preferredHighlighter: "highlights",
		},
	});
}

export default function PierreProvider({ children }: { children: ReactNode }) {
	const { pierreTheme } = useResourceHost().code;
	const [pool] = useState(() => pierreWorkerPool(pierreTheme));
	return <WorkerPoolContext.Provider value={pool}>{children}</WorkerPoolContext.Provider>;
}
