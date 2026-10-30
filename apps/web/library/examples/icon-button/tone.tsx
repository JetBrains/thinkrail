import { RiDeleteBinLine, RiErrorWarningLine, RiStopLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";

export default function Tone() {
	const t = useT();
	return (
		<div className="flex items-center gap-8">
			<IconButton tone="danger" icon={RiStopLine} label={t("resources.inspector.stopAll")} />
			<IconButton tone="danger" icon={RiDeleteBinLine} label={t("common.delete")} />
			<IconButton
				tone="warning"
				icon={RiErrorWarningLine}
				label={t("components.attentionDot.label")}
			/>
		</div>
	);
}
