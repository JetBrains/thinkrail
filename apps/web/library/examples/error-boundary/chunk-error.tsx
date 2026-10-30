import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { lazy, Suspense, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const FilePane = lazy(() =>
	Promise.reject(new Error("Failed to fetch dynamically imported module: /assets/FilePane.js")),
);

export default function ChunkError() {
	const t = useT();
	const [opened, setOpened] = useState(false);
	return (
		<div className="h-[12rem] w-full">
			<ErrorBoundary label={t("shell.workbench.panel.editor")} reportId="editor">
				{opened ? (
					<Suspense fallback={<LoadingRegion className="p-16" />}>
						<FilePane />
					</Suspense>
				) : (
					<div className="flex h-full items-center justify-center">
						<Button variant="outline" size="m" onClick={() => setOpened(true)}>
							{t("panels.diffSurface.openFile")}
						</Button>
					</div>
				)}
			</ErrorBoundary>
		</div>
	);
}
