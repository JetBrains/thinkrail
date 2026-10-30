import { RiArrowDownSLine, RiGitCommitLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { useRef, useState } from "react";

const COMMITS = [
	{ sha: "4f2a9c1", subject: "Add the loading page" },
	{ sha: "b81e07d", subject: "Thread the skeleton label" },
	{ sha: "09cd3aa", subject: "Fade the skeleton in after a grace" },
];

export default function MenuSection() {
	const t = useT();
	const [commits, setCommits] = useState<typeof COMMITS | null>(null);
	const timer = useRef(0);
	return (
		<DropdownMenu
			onOpenChange={(open) => {
				window.clearTimeout(timer.current);
				if (!open) return;
				setCommits(null);
				timer.current = window.setTimeout(() => setCommits(COMMITS), 2000);
			}}
		>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="m" iconRight={RiArrowDownSLine}>
					{t("changes.scopeMenu.uncommitted")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-[18rem]">
				<DropdownMenuItem onSelect={() => {}}>
					{t("changes.scopeMenu.uncommitted")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuLabel>{t("changes.scopeMenu.commits")}</DropdownMenuLabel>
				{commits === null ? (
					<LoadingRegion
						rows={3}
						label={t("changes.scopeMenu.loadingCommits")}
						className="px-8 py-4"
					/>
				) : (
					commits.map((commit) => (
						<DropdownMenuItem key={commit.sha} onSelect={() => {}}>
							<RiGitCommitLine />
							<span className="truncate">{commit.subject}</span>
						</DropdownMenuItem>
					))
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
