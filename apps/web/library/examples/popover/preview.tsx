import { RiArrowDownSLine, RiGitBranchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";

export default function Preview() {
	const t = useT();
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" size="m" iconLeft={RiGitBranchLine} iconRight={RiArrowDownSLine}>
					feature/popover-docs
				</Button>
			</PopoverTrigger>
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
						{t("shell.location.branch.basedOn")}
					</dt>
					<dd className="truncate tr-code-text">main</dd>
				</dl>
			</PopoverContent>
		</Popover>
	);
}
