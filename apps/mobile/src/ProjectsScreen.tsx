import { RiAddLine, RiFolderLine } from "@remixicon/react";
import type { Project } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type {
	RemoteSessionItem,
	RemoteSessionsController,
	SavedHost,
} from "@thinkrail/remote-client";
import { Button } from "@thinkrail/ui/button";
import type { ReactNode } from "react";
import { ListRow, LoadedList, Screen } from "./layout";
import { scopeStatus } from "./status";
import { useHostRequest } from "./useHostRequest";

export function ProjectsScreen({
	hosts,
	controller,
	items,
	unreachable,
	adding,
	onAdd,
	pairForm,
	onOpen,
}: {
	hosts: SavedHost[];
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	unreachable: [host: string, reason: string][];
	adding: boolean;
	onAdd: () => void;
	pairForm: ReactNode;
	onOpen: (hostKey: string, project: Project) => void;
}) {
	const t = useT();
	return (
		<Screen
			title={t("mobile.projects.title")}
			action={
				adding ? null : (
					<Button
						variant="soft-primary"
						className="h-touch shrink-0 rounded-md"
						iconLeft={RiAddLine}
						onClick={onAdd}
					>
						{t("mobile.projects.addHost")}
					</Button>
				)
			}
		>
			{unreachable.map(([host, reason]) => (
				<p
					key={host}
					role="status"
					className="m-0 border-b border-feedback-warning-muted bg-feedback-warning-subtle px-16 py-12 text-feedback-warning tr-text-metadata"
				>
					{t("mobile.projects.unreachable", { host, reason })}
				</p>
			))}
			{adding ? (
				<section className="border-b border-border-default bg-container-elevated-bg px-16 py-16">
					<p className="mt-0 mb-12 text-text-muted tr-text-ui">{t("mobile.projects.addHint")}</p>
					{pairForm}
				</section>
			) : null}
			{hosts
				.filter((host) => !unreachable.some(([label]) => label === host.label))
				.map((host) => (
					<HostProjects
						key={host.hostKey}
						host={host}
						heading={hosts.length > 1}
						controller={controller}
						items={items}
						onOpen={(project) => onOpen(host.hostKey, project)}
					/>
				))}
		</Screen>
	);
}

function HostProjects({
	host,
	heading,
	controller,
	items,
	onOpen,
}: {
	host: SavedHost;
	heading: boolean;
	controller: RemoteSessionsController;
	items: RemoteSessionItem[];
	onOpen: (project: Project) => void;
}) {
	const t = useT();
	const loaded = useHostRequest<Project[]>(controller.clientFor(host.hostKey), "project.list", {});
	const open =
		loaded.kind === "ready" ? { ...loaded, value: loaded.value.filter((p) => !p.closed) } : loaded;

	return (
		<section>
			{heading ? (
				<h2 className="m-0 border-b border-border-muted px-16 pt-16 pb-8 text-text-subtle tr-text-eyebrow">
					{host.label}
				</h2>
			) : null}
			<LoadedList loaded={open} empty={t("mobile.projects.empty")}>
				{(projects) =>
					projects.map((project) => (
						<ListRow
							key={project.id}
							icon={RiFolderLine}
							title={project.name}
							status={scopeStatus(
								items,
								(item) => item.hostKey === host.hostKey && item.record.projectId === project.id,
							)}
							onOpen={() => onOpen(project)}
						/>
					))
				}
			</LoadedList>
		</section>
	);
}
