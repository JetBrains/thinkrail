import { RiMore2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";

export default function MenuTrigger() {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton icon={RiMore2Line} label={t("shell.location.ship.moreActions")} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuItem onSelect={() => {}}>{t("common.rename")}</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => {}}>{t("common.delete")}</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
