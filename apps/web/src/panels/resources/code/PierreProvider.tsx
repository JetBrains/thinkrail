import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from "@pierre/diffs/worker";
import { type ReactNode, useState } from "react";

registerCustomCSSVariableTheme("thinkrail", {
	background: "var(--container-content-bg)",
	foreground: "var(--code-foreground)",
});

const POOL_SIZE = 4;

function pierreWorkerPool(): WorkerPoolManager {
	return getOrCreateWorkerPoolSingleton({
		poolOptions: {
			poolSize: POOL_SIZE,
			workerFactory: () =>
				new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
					type: "module",
				}),
		},
		highlighterOptions: { theme: "thinkrail", lineDiffType: "word" },
	});
}

export default function PierreProvider({ children }: { children: ReactNode }) {
	const [pool] = useState(pierreWorkerPool);
	return <WorkerPoolContext.Provider value={pool}>{children}</WorkerPoolContext.Provider>;
}
