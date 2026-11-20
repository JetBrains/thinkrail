import {
	RiArrowLeftLine as Back,
	RiCloseLine as Close,
	RiArrowRightLine as Forward,
	RiFullscreenLine as Fullscreen,
	RiArrowRightUpLine as OpenTab,
	RiPushpinFill as Pinned,
	RiPushpinLine as Unpinned,
} from "@remixicon/react";
import type { Container } from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import {
	ResourceHostProvider,
	ResourcePreview,
	type ResourcePreviewLayout,
	ResourceScopeProvider,
	SOURCE_RENDERER_ID,
} from "@thinkrail/resource-renderers";
import { Button, IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { useMemo, useState } from "react";
import { fileName } from "../lib";
import { ContainerOverview } from "../panels/ContainerOverview";
import { type PeekEntry, peekEntryIdentity, useAppStore } from "../store";
import { PEEK_HOST } from "./AppResourceHost";
import { ExtensionContainerSections } from "./ExtensionContainerSections";
import { ExtensionPanelBody } from "./ExtensionPanelBody";
import { type LayoutExtensionTab, layoutTabName } from "./layout";
import { hidePeekFrom, openPeekInTab, removePeekEntryFrom } from "./peekControl";

interface PeekView {
	rendererId?: string;
	layout?: ResourcePreviewLayout;
	viewState?: unknown;
}

type ExtensionEntry = Extract<PeekEntry, { kind: "extension" }>;
type ResourceEntry = Extract<PeekEntry, { kind: "file" | "compare" }>;
type ContainerNames = Readonly<Record<string, Pick<Container, "name">>>;

function extensionTab(entry: ExtensionEntry): LayoutExtensionTab {
	return {
		kind: "extension",
		id: peekEntryIdentity(entry),
		name: entry.name ?? "",
		extension: entry.extension,
		panel: entry.panel,
		titleKey: entry.titleKey,
		params: entry.params,
	};
}

function entryName(t: Translator, entry: PeekEntry, containers: ContainerNames): string {
	switch (entry.kind) {
		case "file":
			return fileName(entry.path);
		case "compare":
			return t("peek.compareName", {
				before: fileName(entry.before),
				after: fileName(entry.after),
			});
		case "extension":
			return layoutTabName(t, extensionTab(entry));
		case "container":
			return t("containers.overview.crumb", {
				name: containers[entry.containerId]?.name ?? "",
			});
	}
}

function entryPath(t: Translator, entry: PeekEntry): string | undefined {
	if (entry.kind === "file") return entry.path;
	if (entry.kind === "compare") {
		return t("peek.compareName", { before: entry.before, after: entry.after });
	}
	return undefined;
}

function PeekResource({
	workspaceId,
	entry,
	view,
	onView,
	onRemove,
	className,
}: {
	workspaceId: string;
	entry: ResourceEntry;
	view: PeekView;
	onView: (view: PeekView) => void;
	onRemove: () => void;
	className: string;
}) {
	const t = useT();
	const sessionId = entry.sessionId;
	const scope = useMemo(
		() => ({ workspaceId, ...(sessionId ? { sessionId } : {}) }),
		[sessionId, workspaceId],
	);
	const line = entry.kind === "file" ? entry.line : undefined;
	const reveal = useMemo(() => (line === undefined ? undefined : { line, tick: 1 }), [line]);
	return (
		<ResourceHostProvider value={PEEK_HOST}>
			<ResourceScopeProvider value={scope}>
				<ResourcePreview
					path={entry.kind === "file" ? entry.path : entry.after}
					before={entry.kind === "compare" ? entry.before : undefined}
					compact={false}
					rendererId={view.rendererId ?? (line === undefined ? undefined : SOURCE_RENDERER_ID)}
					onRendererId={(rendererId) => onView({ rendererId })}
					layout={view.layout ?? "unified"}
					onLayout={(layout) => onView({ layout })}
					viewState={view.viewState}
					onViewState={(viewState) => onView({ viewState })}
					reveal={reveal}
					className={className}
					failureAction={
						<Button variant="outline" size="m" data-testid="peek-remove" onClick={onRemove}>
							{t("peek.remove")}
						</Button>
					}
				/>
			</ResourceScopeProvider>
		</ResourceHostProvider>
	);
}

function PeekEntryBody({
	workspaceId,
	entry,
	view,
	onView,
	onRemove,
	className,
}: {
	workspaceId: string;
	entry: PeekEntry;
	view: PeekView;
	onView: (view: PeekView) => void;
	onRemove: () => void;
	className: string;
}) {
	if (entry.kind === "extension") {
		return (
			<div className={className}>
				<ExtensionPanelBody workspaceId={workspaceId} tab={extensionTab(entry)} />
			</div>
		);
	}
	if (entry.kind === "container") {
		return (
			<div className={className}>
				<ContainerOverview
					containerId={entry.containerId}
					workspaceId={workspaceId}
					extensionSections={<ExtensionContainerSections containerId={entry.containerId} />}
				/>
			</div>
		);
	}
	return (
		<PeekResource
			workspaceId={workspaceId}
			entry={entry}
			view={view}
			onView={onView}
			onRemove={onRemove}
			className={className}
		/>
	);
}

function PeekCrumbs({
	workspaceId,
	stack,
	index,
}: {
	workspaceId: string;
	stack: readonly PeekEntry[];
	index: number;
}) {
	const t = useT();
	const containers = useAppStore((state) => state.containers);
	return (
		<ol
			aria-label={t("peek.history")}
			data-testid="peek-crumbs"
			className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
		>
			{stack.map((entry, position) => {
				const name = entryName(t, entry, containers);
				const current = position === index;
				return (
					<li
						key={peekEntryIdentity(entry)}
						data-testid="peek-crumb"
						data-current={current || undefined}
						className="flex h-panel-header-control min-w-24 shrink items-center rounded-sm text-text-muted data-[current]:bg-control-bg-selected data-[current]:text-text-default"
					>
						<button
							type="button"
							aria-current={current ? "true" : undefined}
							title={entryPath(t, entry)}
							className="min-w-0 truncate rounded-sm pl-8 tr-text-metadata hover:text-text-default"
							onClick={() => useAppStore.getState().showPeekEntry(workspaceId, position)}
						>
							{name}
						</button>
						<IconButton
							size="s"
							icon={Close}
							label={t("peek.removeEntry", { name })}
							data-testid="peek-crumb-remove"
							onClick={() => removePeekEntryFrom(workspaceId, position)}
							className="shrink-0"
						/>
					</li>
				);
			})}
		</ol>
	);
}

export function PeekPane({ workspaceId }: { workspaceId: string }) {
	const t = useT();
	const peek = useAppStore((state) => state.peekByWorkspace[workspaceId]);
	const containers = useAppStore((state) => state.containers);
	const [views, setViews] = useState<Readonly<Record<string, PeekView>>>({});
	const [fullscreen, setFullscreen] = useState(false);
	const entry = peek?.stack[peek.index];
	if (!peek || !entry) return null;
	const identity = peekEntryIdentity(entry);
	const view = views[identity] ?? {};
	const setView = (patch: PeekView) =>
		setViews((current) => ({ ...current, [identity]: { ...current[identity], ...patch } }));
	const remove = () => removePeekEntryFrom(workspaceId, peek.index);
	const store = useAppStore.getState;
	return (
		<div data-testid="peek-pane" className="flex h-full min-h-0 flex-col">
			<div
				role="toolbar"
				aria-label={t("peek.toolbar")}
				className="flex h-panel-header-row shrink-0 items-center gap-2 border-border-muted border-b bg-container-header-bg px-4"
			>
				<IconButton
					icon={Back}
					label={t("peek.back")}
					data-testid="peek-back"
					disabled={peek.index === 0}
					onClick={() => store().peekBack(workspaceId)}
				/>
				<IconButton
					icon={Forward}
					label={t("peek.forward")}
					data-testid="peek-forward"
					disabled={peek.index >= peek.stack.length - 1}
					onClick={() => store().peekForward(workspaceId)}
				/>
				<PeekCrumbs workspaceId={workspaceId} stack={peek.stack} index={peek.index} />
				<IconButton
					icon={peek.pinned ? Pinned : Unpinned}
					label={t(peek.pinned ? "peek.unpin" : "peek.pin")}
					data-testid="peek-pin"
					aria-pressed={peek.pinned}
					selected={peek.pinned}
					onClick={() => store().pinPeek(workspaceId, !peek.pinned)}
				/>
				{entry.kind === "container" ? null : (
					<IconButton
						icon={OpenTab}
						label={t("peek.openInTab")}
						data-testid="peek-open-tab"
						onClick={() => openPeekInTab(workspaceId)}
					/>
				)}
				<IconButton
					icon={Fullscreen}
					label={t("peek.fullScreen")}
					data-testid="peek-fullscreen"
					onClick={() => setFullscreen(true)}
				/>
				<IconButton
					icon={Close}
					label={t("peek.close")}
					data-testid="peek-close"
					onClick={() => hidePeekFrom(workspaceId)}
				/>
			</div>
			<PeekEntryBody
				key={identity}
				workspaceId={workspaceId}
				entry={entry}
				view={view}
				onView={setView}
				onRemove={remove}
				className="min-h-0 flex-1"
			/>
			<Dialog open={fullscreen} onOpenChange={setFullscreen}>
				<DialogContent
					data-testid="peek-fullscreen-dialog"
					className="h-[90vh] w-[95vw] max-w-[95vw] gap-8"
				>
					<DialogHeader>
						<DialogTitle>{entryName(t, entry, containers)}</DialogTitle>
					</DialogHeader>
					{fullscreen ? (
						<PeekEntryBody
							key={identity}
							workspaceId={workspaceId}
							entry={entry}
							view={view}
							onView={setView}
							onRemove={remove}
							className="min-h-0 flex-1 rounded-sm border border-border-default"
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
}
