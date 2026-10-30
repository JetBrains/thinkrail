import { RiFileCopyLine, RiHistoryLine, RiRefreshLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";

export default function BuiltIn() {
	const t = useT();
	return (
		<div className="flex items-center gap-8">
			<IconButton icon={RiFileCopyLine} label={t("common.copy")} onClick={() => {}} />
			<IconButton
				icon={RiHistoryLine}
				label={t("shell.chatHistory.reopen")}
				tooltip={t("shell.chatHistory.view")}
				onClick={() => {}}
			/>
			<Button
				variant="outline"
				size="m"
				iconLeft={RiRefreshLine}
				tooltip={t("chat.skills.reloadHint")}
				onClick={() => {}}
			>
				{t("chat.skills.reload")}
			</Button>
		</div>
	);
}
