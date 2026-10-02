import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import { WorkerPoolContextProvider, type WorkerPoolOptions } from "@pierre/diffs/react";
import type { ReactNode } from "react";

registerCustomCSSVariableTheme("thinkrail", {
	background: "var(--container-content-bg)",
	foreground: "var(--code-foreground)",
});

const poolOptions: WorkerPoolOptions = {
	workerFactory: () =>
		new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
};

export default function PierreProvider({ children }: { children: ReactNode }) {
	return (
		<WorkerPoolContextProvider
			poolOptions={poolOptions}
			highlighterOptions={{ theme: "thinkrail", lineDiffType: "word" }}
		>
			{children}
		</WorkerPoolContextProvider>
	);
}
