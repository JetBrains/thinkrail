import { RiFileCopyLine, RiGitBranchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { useRef } from "react";

const BRANCH = "feature/popover-docs";

export default function InitialFocus() {
	const t = useT();
	const contentRef = useRef<HTMLDivElement>(null);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="m" iconLeft={RiGitBranchLine}>
					{BRANCH}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				ref={contentRef}
				align="start"
				aria-label={t("shell.location.branch.caption")}
				className="flex w-288 flex-col gap-8 p-12"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					contentRef.current?.focus();
				}}
			>
				<div className="flex items-center gap-8">
					<span className="min-w-0 flex-1 truncate tr-code-text">{BRANCH}</span>
					<IconButton
						icon={RiFileCopyLine}
						label={t("shell.location.branch.copyName")}
						onClick={() => void navigator.clipboard?.writeText(BRANCH)}
					/>
				</div>
				<span className="tr-text-metadata text-text-muted">
					{t("shell.location.branch.basedOn")} main
				</span>
			</PopoverContent>
		</Popover>
	);
}
