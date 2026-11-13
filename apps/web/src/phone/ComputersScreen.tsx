import { RiAddLine, RiCloseLine } from "@remixicon/react";
import type { Project, Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type {
	HostStatus,
	RemoteSessionItem,
	RemoteSessionsController,
	SavedHost,
} from "@thinkrail/remote-client";
import { Button, IconButton } from "@thinkrail/ui/button";
import { type ReactNode, useState } from "react";
import type { PairState } from "./App";
import { Screen } from "./layout";
import { HostTree } from "./ProjectTree";

/**
 * The Devices tab: the IDE project tree with the paired computers as its top level — a computer expands in
 * place into its projects, a project into its live workspaces; the header's + opens Add a device.
 */
export function ComputersScreen({
	hosts,
	statusOf,
	controller,
	items,
	pair,
	onPair,
	collapsed,
	onToggleHost,
	expanded,
	onToggle,
	onReconnect,
	onForget,
	onNewWorktree,
	onOpen,
	onAdd,
	footer,
}: {
	hosts: SavedHost[];
	statusOf: (hostKey: string) => HostStatus;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	/** Computers folded shut; a computer starts open. */
	collapsed: ReadonlySet<string>;
	onToggleHost: (hostKey: string) => void;
	/** Expanded projects, keyed `hostKey:projectId`. */
	expanded: ReadonlySet<string>;
	onToggle: (key: string) => void;
	onReconnect: (host: SavedHost) => void;
	onForget: (host: SavedHost) => void;
	onNewWorktree: (hostKey: string, project: Project) => void;
	onOpen: (hostKey: string, project: Project, workspace: Workspace) => void;
	onAdd: () => void;
	footer: ReactNode;
}) {
	const t = useT();
	const [failure, setFailure] = useState<string | null>(null);
	return (
		<Screen
			title={t("mobile.devices.title")}
			surface="sidebar"
			action={
				<Button
					variant="ghost"
					className="h-touch shrink-0 rounded-md px-12"
					iconLeft={RiAddLine}
					aria-label={t("mobile.devices.add")}
					data-testid="devices-add"
					onClick={onAdd}
				>
					{t("mobile.devices.addShort")}
				</Button>
			}
			footer={footer}
		>
			{failure ? (
				<div
					role="alert"
					className="flex items-center gap-8 border-b border-feedback-error-muted bg-feedback-error-subtle py-4 pr-4 pl-16"
				>
					<p className="m-0 min-w-0 flex-1 text-feedback-error tr-text-metadata">{failure}</p>
					<IconButton
						size="l"
						className="size-touch shrink-0"
						icon={RiCloseLine}
						label={t("common.dismiss")}
						onClick={() => setFailure(null)}
					/>
				</div>
			) : null}
			<ul data-testid="computers" className="m-0 list-none p-0">
				{hosts.map((host) => (
					<HostTree
						key={host.hostKey}
						host={host}
						status={statusOf(host.hostKey)}
						controller={controller}
						items={items.filter((item) => item.hostKey === host.hostKey)}
						pair={pair}
						onPair={onPair}
						open={!collapsed.has(host.hostKey)}
						onToggleOpen={() => onToggleHost(host.hostKey)}
						expanded={expanded}
						onToggle={onToggle}
						onReconnect={() => onReconnect(host)}
						onForget={() => onForget(host)}
						onFailure={setFailure}
						onNewWorktree={(project) => onNewWorktree(host.hostKey, project)}
						onOpen={(project, workspace) => onOpen(host.hostKey, project, workspace)}
					/>
				))}
			</ul>
		</Screen>
	);
}
