import { RiGitBranchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { AttentionDot } from "@/components/AttentionDot";

const WORKSPACES = [
	{ id: "fix-login", reason: "notifications.reason.needsInput" },
	{ id: "pricing", reason: "notifications.reason.succeeded" },
	{ id: "migrate-db", reason: "notifications.reason.failed" },
] as const;

export default function OneMarker() {
	const t = useT();
	return (
		<ul className="flex w-full max-w-xs flex-col gap-8">
			{WORKSPACES.map((workspace) => (
				<li key={workspace.id} className="flex min-w-0 items-start gap-8">
					<span className="flex min-w-0 flex-1 items-start gap-4">
						<RiGitBranchLine className="mt-2 size-14 shrink-0 text-text-muted" />
						<span className="flex min-w-0 flex-col">
							<span className="truncate tr-text-ui leading-tight text-text-muted">
								{workspace.id}
							</span>
							<span className="truncate text-text-subtle tr-text-metadata leading-tight">
								{t(workspace.reason)}
							</span>
						</span>
					</span>
					<AttentionDot />
				</li>
			))}
		</ul>
	);
}
