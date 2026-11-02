import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { type ReactNode, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function Region({ children }: { children: ReactNode }) {
	const t = useT();
	const [opened, setOpened] = useState(false);
	if (opened) throw new Error("Cannot read properties of undefined (reading 'rows')");
	return (
		<div className="flex h-full flex-col items-center justify-center gap-8">
			<span className="tr-text-ui text-text-muted">{children}</span>
			<Button variant="outline" size="m" onClick={() => setOpened(true)}>
				{t("panels.diffSurface.openFile")}
			</Button>
		</div>
	);
}

export default function Regions() {
	const t = useT();
	return (
		<div className="h-[14rem] w-full">
			<ErrorBoundary label={t("app.errorBoundary.label")} reportId="app">
				<div className="grid h-full grid-cols-2 gap-16">
					<ErrorBoundary label={t("shell.workbench.panel.editor")} reportId="editor">
						<Region>src/App.tsx</Region>
					</ErrorBoundary>
					<ErrorBoundary label={t("shell.workbench.panel.terminal")} reportId="terminal">
						<Region>zsh</Region>
					</ErrorBoundary>
				</div>
			</ErrorBoundary>
		</div>
	);
}
