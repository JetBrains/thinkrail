import { RiCloseLine, RiStackLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogClose, DialogPanel, DialogTitle, DialogTrigger } from "@thinkrail/ui/dialog";

export default function Panel() {
	const t = useT();
	return (
		<div className="relative flex h-[12rem] w-full flex-col items-start gap-8">
			<Dialog modal={false}>
				<DialogTrigger asChild>
					<Button variant="outline" size="m" iconLeft={RiStackLine}>
						{t("resources.inspector.title")}
					</Button>
				</DialogTrigger>
				<DialogPanel
					aria-describedby={undefined}
					onInteractOutside={(event) => event.preventDefault()}
					className="absolute inset-0 gap-8 border p-8"
				>
					<div className="flex items-center gap-8">
						<DialogTitle className="flex-1">{t("resources.inspector.title")}</DialogTitle>
						<DialogClose asChild>
							<IconButton icon={RiCloseLine} label={t("resources.inspector.close")} />
						</DialogClose>
					</div>
					<p className="tr-text-ui text-text-muted">{t("resources.inspector.empty")}</p>
				</DialogPanel>
			</Dialog>
		</div>
	);
}
