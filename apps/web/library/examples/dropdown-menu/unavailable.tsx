import { RiAddLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";

const missingTools = ["Files", "Changes"];

export default function Unavailable() {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton icon={RiAddLine} label={t("workbench.group.addTo")} wrapTrigger />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem disabled onSelect={() => {}}>
					{t("workbench.menu.unavailable", {
						label: t("workbench.group.newTerminalPaneBelow"),
						reason: t("workbench.tab.limitedTo", { limit: 4 }),
					})}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{missingTools.map((name) => (
					<DropdownMenuItem key={name} onSelect={() => {}}>
						{t("workbench.tab.showTool", { name })}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
