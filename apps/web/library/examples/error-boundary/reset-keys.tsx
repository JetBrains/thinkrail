import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const TABS = ["App.tsx", "main.ts"];

function FileView({ path }: { path: string }) {
	const t = useT();
	const [opened, setOpened] = useState(false);
	if (opened) throw new Error(`Cannot render ${path}`);
	return (
		<div className="flex h-full flex-col items-center justify-center gap-8">
			<span className="tr-text-ui text-text-muted">{path}</span>
			<Button variant="outline" size="m" onClick={() => setOpened(true)}>
				{t("panels.diffSurface.openFile")}
			</Button>
		</div>
	);
}

export default function ResetKeys() {
	const t = useT();
	const [tab, setTab] = useState("App.tsx");
	return (
		<div className="flex h-[14rem] w-full flex-col gap-8">
			<div className="flex gap-2">
				{TABS.map((path) => (
					<ToggleSegment
						key={path}
						testid={`tab-${path}`}
						label={path}
						active={tab === path}
						onClick={() => setTab(path)}
					/>
				))}
			</div>
			<div className="min-h-0 flex-1">
				<ErrorBoundary
					label={t("shell.workbench.panel.editor")}
					reportId="editor"
					resetKeys={["workspace-1", tab]}
				>
					<FileView path={tab} />
				</ErrorBoundary>
			</div>
		</div>
	);
}
