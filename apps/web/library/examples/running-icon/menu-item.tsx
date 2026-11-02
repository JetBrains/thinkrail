import { RiArrowDownSLine, RiGitBranchLine, RiHome2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { RunningIcon } from "@/components/RunningIcon";

const WORKSPACES = [
	{ id: "command-docs", isDefault: false, running: true },
	{ id: "thinkrail", isDefault: true, running: false },
	{ id: "pricing", isDefault: false, running: false },
];

export default function MenuItem() {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="m" iconRight={RiArrowDownSLine}>
					fix-login
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuLabel>{t("shell.location.workspace.switchTo")}</DropdownMenuLabel>
				{WORKSPACES.map((workspace) => {
					const Icon = workspace.isDefault ? RiHome2Line : RiGitBranchLine;
					return (
						<DropdownMenuItem key={workspace.id} onSelect={() => {}}>
							{workspace.running ? <RunningIcon className="size-14 text-primary" /> : <Icon />}
							<span className="truncate">{workspace.id}</span>
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
