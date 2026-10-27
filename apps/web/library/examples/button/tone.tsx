import { RiDeleteBinLine, RiErrorWarningLine, RiStopLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";

export default function Tone() {
	const t = useT();
	return (
		<div className="flex flex-wrap items-center gap-8">
			<Button variant="ghost" size="m" tone="danger" iconLeft={RiStopLine}>
				{t("resources.inspector.stopAll")}
			</Button>
			<Button variant="outline" size="m" tone="danger" iconLeft={RiDeleteBinLine}>
				{t("common.delete")}
			</Button>
			<Button variant="ghost" size="m" tone="warning" iconLeft={RiErrorWarningLine}>
				{t("lib.mcpState.pendingApproval")}
			</Button>
		</div>
	);
}
