import { RiGitBranchLine, RiMailOpenLine, RiMailUnreadLine, RiMore2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useState } from "react";
import { AttentionDot } from "@/components/AttentionDot";

export default function MarkRead() {
	const t = useT();
	const [unread, setUnread] = useState(true);
	return (
		<div className="flex w-full max-w-xs min-w-0 items-center gap-8">
			<button type="button" className="flex min-w-0 flex-1 items-center gap-4 text-left">
				<RiGitBranchLine className="size-14 shrink-0 text-text-muted" />
				<span className="truncate tr-text-ui text-text-muted">pricing</span>
			</button>
			{unread ? <AttentionDot /> : null}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<IconButton
						icon={RiMore2Line}
						label={t("panels.projectTree.workspaceActions", { name: "pricing" })}
						size="s"
						className="shrink-0"
					/>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{unread ? (
						<DropdownMenuItem onSelect={() => setUnread(false)}>
							<RiMailOpenLine />
							{t("panels.projectTree.markRead")}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem onSelect={() => setUnread(true)}>
							<RiMailUnreadLine />
							{t("panels.projectTree.markUnread")}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
