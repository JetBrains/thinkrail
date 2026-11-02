import { RiMore2Line } from "@remixicon/react";
import { T, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useRef, useState } from "react";
import { ConfirmDialog } from "@/panels/ConfirmDialog";

export default function FromMenu() {
	const t = useT();
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<IconButton
						ref={trigger}
						icon={RiMore2Line}
						label={t("shell.location.ship.moreActions")}
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start">
					<DropdownMenuItem onSelect={() => {}}>{t("common.rename")}</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setOpen(true)}>{t("common.remove")}</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ConfirmDialog
				open={open}
				onOpenChange={setOpen}
				title={t("panels.removeWorkspace.title", { name: "fix-login" })}
				description={
					<T
						i18nKey="panels.removeWorkspace.description"
						values={{ branch: "fix/login" }}
						components={[<span key="branch" className="tr-text-emphasis text-text-default" />]}
					/>
				}
				confirmLabel={t("common.remove")}
				destructive
				onConfirm={() => {}}
				onClosedAutoFocus={() => trigger.current?.focus()}
			/>
		</>
	);
}
