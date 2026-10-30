import { RiGitBranchLine, RiMore2Line } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { AttentionDot } from "@/components/AttentionDot";

const WORKSPACES = [
	{ id: "fix-login", needsAttention: true },
	{ id: "command-docs", needsAttention: false },
	{ id: "pricing", needsAttention: true },
];

export default function WorkspaceRows() {
	const t = useT();
	return (
		<ul className="flex w-full max-w-xs flex-col gap-4">
			{WORKSPACES.map((workspace) => (
				<li
					key={workspace.id}
					data-attention={workspace.needsAttention || undefined}
					className="flex min-w-0 items-center gap-8"
				>
					<button type="button" className="flex min-w-0 flex-1 items-center gap-4 text-left">
						<RiGitBranchLine className="size-14 shrink-0 text-text-muted" />
						<span className="truncate tr-text-ui text-text-muted">{workspace.id}</span>
					</button>
					{workspace.needsAttention ? <AttentionDot /> : null}
					<IconButton
						icon={RiMore2Line}
						label={t("panels.projectTree.workspaceActions", { name: workspace.id })}
						size="s"
						className="shrink-0"
					/>
				</li>
			))}
		</ul>
	);
}
