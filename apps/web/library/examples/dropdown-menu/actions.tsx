import {
	RiDownloadLine,
	RiFileCopyLine,
	RiGitPullRequestLine,
	RiListCheck3,
	RiMore2Line,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";

export default function Actions() {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<IconButton icon={RiMore2Line} label={t("plan.menu.label")} wrapTrigger />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onSelect={() => {}}>
					<RiFileCopyLine />
					{t("common.copy")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => {}}>
					<RiDownloadLine />
					{t("plan.menu.saveMarkdown")}
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => {}}>
					<RiGitPullRequestLine />
					{t("plan.menu.openDraftPr")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => {}}>
					<RiListCheck3 />
					{t("plan.menu.checkAllCount", { count: 3 })}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
