import { RiArrowDownSLine, RiArrowUpLine, RiGitBranchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useState } from "react";

export default function Controlled() {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<div className="flex flex-wrap items-center gap-8">
				<PopoverTrigger asChild>
					<Button variant="ghost" size="m" iconLeft={RiGitBranchLine} iconRight={RiArrowDownSLine}>
						feature/popover-docs
					</Button>
				</PopoverTrigger>
				<Button
					variant="ghost"
					size="s"
					tone="warning"
					iconLeft={RiArrowUpLine}
					onClick={() => setOpen(true)}
				>
					{t("shell.location.remote.unpushedChip", { count: 2 })}
				</Button>
			</div>
			<PopoverContent
				align="start"
				aria-label={t("shell.location.branch.caption")}
				className="w-288 p-12"
			>
				<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-12 gap-y-8">
					<dt className="tr-text-metadata text-text-subtle">
						{t("shell.location.branch.caption")}
					</dt>
					<dd className="truncate tr-code-text">feature/popover-docs</dd>
					<dt className="tr-text-metadata text-text-subtle">
						{t("shell.location.remote.caption")}
					</dt>
					<dd className="truncate tr-text-ui">
						{t("shell.location.remote.unpushedCommits", { count: 2 })}
					</dd>
				</dl>
			</PopoverContent>
		</Popover>
	);
}
