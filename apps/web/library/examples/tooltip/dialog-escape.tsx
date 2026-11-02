import { RiBookOpenLine, RiRefreshLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@thinkrail/ui/dialog";
import { useState } from "react";

export default function DialogEscape() {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<IconButton
				variant="outline"
				icon={RiBookOpenLine}
				label={t("chat.skills.title")}
				onClick={() => setOpen(true)}
			/>
			<DialogContent>
				<div className="flex items-center justify-between gap-8 pr-32">
					<DialogTitle>{t("chat.skills.title")}</DialogTitle>
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
				<DialogDescription>{t("chat.skills.reloadedBody")}</DialogDescription>
			</DialogContent>
		</Dialog>
	);
}
