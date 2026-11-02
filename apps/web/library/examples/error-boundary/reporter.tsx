import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { ErrorBoundary, setErrorBoundaryReporter } from "@/components/ErrorBoundary";

function ChatView() {
	const t = useT();
	const [opened, setOpened] = useState(false);
	if (opened) throw new Error("Cannot read properties of undefined (reading 'turns')");
	return (
		<div className="flex h-full items-center justify-center">
			<Button variant="outline" size="m" onClick={() => setOpened(true)}>
				{t("mcp.action.openChat")}
			</Button>
		</div>
	);
}

export default function Reporter() {
	const t = useT();
	const [report, setReport] = useState("—");
	useEffect(() => {
		setErrorBoundaryReporter((error, reportId) => setReport(`${reportId}: ${error.message}`));
		return () => setErrorBoundaryReporter(null);
	}, []);
	return (
		<div className="flex w-full flex-col gap-8">
			<div className="h-[12rem]">
				<ErrorBoundary label={t("shell.workbench.panel.chat")} reportId="chat">
					<ChatView />
				</ErrorBoundary>
			</div>
			<output className="tr-code-text text-text-muted">{report}</output>
		</div>
	);
}
