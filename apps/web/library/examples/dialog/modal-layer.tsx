import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	useModalLayerOpen,
} from "@thinkrail/ui/dialog";

function CoveredByModal() {
	const modalOpen = useModalLayerOpen();
	return <output className="tr-code-text">useModalLayerOpen() → {String(modalOpen)}</output>;
}

export default function ModalLayer() {
	const t = useT();
	return (
		<div className="flex flex-wrap items-center gap-12">
			<Dialog>
				<DialogTrigger asChild>
					<Button variant="outline" size="m">
						{t("mcp.fullOutput.title")}
					</Button>
				</DialogTrigger>
				<DialogContent aria-describedby={undefined}>
					<DialogHeader>
						<DialogTitle>{t("mcp.fullOutput.title")}</DialogTitle>
					</DialogHeader>
					<CoveredByModal />
				</DialogContent>
			</Dialog>
			<CoveredByModal />
		</div>
	);
}
