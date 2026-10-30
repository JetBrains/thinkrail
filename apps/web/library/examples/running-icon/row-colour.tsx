import { RiGitBranchLine } from "@remixicon/react";
import { useState } from "react";
import { RunningIcon } from "@/components/RunningIcon";

const WORKSPACES = [
	{ id: "fix-login", running: true },
	{ id: "command-docs", running: true },
	{ id: "pricing", running: false },
];

export default function RowColour() {
	const [activeId, setActiveId] = useState("fix-login");
	return (
		<ul className="flex w-full max-w-xs flex-col gap-4">
			{WORKSPACES.map((workspace) => {
				const colour = workspace.id === activeId ? "text-primary" : "text-text-muted";
				return (
					<li key={workspace.id}>
						<button
							type="button"
							aria-current={workspace.id === activeId || undefined}
							onClick={() => setActiveId(workspace.id)}
							className="flex w-full min-w-0 items-center gap-4 text-left"
						>
							{workspace.running ? (
								<RunningIcon className={`size-14 ${colour}`} />
							) : (
								<RiGitBranchLine className={`size-14 shrink-0 ${colour}`} />
							)}
							<span className={`truncate tr-text-ui ${colour}`}>{workspace.id}</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}
