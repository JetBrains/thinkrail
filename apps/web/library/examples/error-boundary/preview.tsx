import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function FileView() {
	const t = useT();
	const [opened, setOpened] = useState(false);
	if (opened) throw new Error("Cannot read properties of undefined (reading 'title')");
	return (
		<div className="flex h-full flex-col items-center justify-center gap-8">
			<span className="tr-text-ui text-text-muted">src/App.tsx</span>
			<Button variant="outline" size="m" onClick={() => setOpened(true)}>
				{t("panels.diffSurface.openFile")}
			</Button>
		</div>
	);
}

export default function Preview() {
	const t = useT();
	return (
		<div className="h-[12rem] w-full">
			<ErrorBoundary
				label={t("shell.workbench.panel.editor")}
				reportId="editor"
				resetKeys={["workspace-1", "tab-1"]}
			>
				<FileView />
			</ErrorBoundary>
		</div>
	);
}
