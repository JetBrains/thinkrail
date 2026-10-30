import {
	RiAddLine,
	RiEditLine,
	RiFolderLine,
	RiGlobalLine,
	RiSparkling2Line,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";

const recents = ["~/code/thinkrail", "~/code/thinkrail-extensions", "~/work/design-tokens"];

export default function Sections() {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="m" iconLeft={RiAddLine}>
					{t("panels.projectTree.addProject")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				<DropdownMenuItem onSelect={() => {}}>
					<RiSparkling2Line />
					<span>{t("panels.addProject.startNew")}</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => {}}>
					<RiFolderLine />
					<span>{t("panels.addProject.open")}</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => {}}>
					<RiEditLine />
					<span>{t("panels.addProject.enterHostPath")}</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => {}}>
					<RiGlobalLine />
					<span>{t("panels.addProject.clone")}</span>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>{t("panels.addProject.recents")}</DropdownMenuLabel>
				<DropdownMenuGroup>
					{recents.map((path) => (
						<DropdownMenuItem key={path} onSelect={() => {}}>
							<RiFolderLine />
							<span className="truncate">{path}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
