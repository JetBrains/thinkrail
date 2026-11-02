import { RiMore2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { Switch } from "@thinkrail/ui/switch";
import { useState } from "react";

export default function RowActions() {
	const t = useT();
	const name = "github";
	const [enabled, setEnabled] = useState(true);
	return (
		<div className="flex w-full max-w-[28rem] flex-wrap items-center gap-8">
			<span className="min-w-0 flex-1 truncate tr-title-compact text-text-default">{name}</span>
			<div className="ml-auto flex shrink-0 items-center gap-8">
				<Button variant="outline" size="m" onClick={() => {}}>
					{t("mcp.action.testConnection")}
				</Button>
				<Switch
					checked={enabled}
					label={t(enabled ? "mcp.server.disable" : "mcp.server.enable", { name })}
					testId="mcp-server-toggle"
					onCheckedChange={setEnabled}
				/>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<IconButton icon={RiMore2Line} label={t("mcp.server.more", { name })} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={() => {}}>{t("common.edit")}</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => {}}>{t("common.remove")}</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
