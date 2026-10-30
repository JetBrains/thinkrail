import { useT } from "@thinkrail/locales/react";
import { QuietScrollArea } from "@/components/QuietScrollArea";

export default function ShortContent() {
	const t = useT();
	return (
		<div className="h-120 w-full max-w-[20rem] bg-container-sidebar-bg">
			<QuietScrollArea className="h-full" viewportClassName="p-panel-inset">
				<p className="px-8 py-4 tr-text-metadata text-text-subtle">{t("review.panel.empty")}</p>
			</QuietScrollArea>
		</div>
	);
}
