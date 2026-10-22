import { RiFullscreenLine as Fullscreen, RiArrowRightUpLine as OpenTab } from "@remixicon/react";
import { strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import {
	ResourcePreview,
	type ResourcePreviewLayout,
	useOptionalResourceHost,
	useResourceScope,
} from "@thinkrail/resource-renderers";
import { type ButtonIcon, IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { useState } from "react";

function FileLink({
	path,
	onOpenFile,
}: {
	path: string;
	onOpenFile: ToolRenderProps["onOpenFile"];
}) {
	if (!onOpenFile) return <span className="min-w-0 truncate text-text-default">{path}</span>;
	return (
		<button
			type="button"
			data-testid="tool-visualize-file-link"
			onClick={() => onOpenFile(path)}
			className="min-w-0 cursor-pointer truncate rounded-xs text-left text-text-default outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
		>
			{path}
		</button>
	);
}

function CardAction({
	testid,
	label,
	icon,
	onClick,
}: {
	testid: string;
	label: string;
	icon: ButtonIcon;
	onClick: () => void;
}) {
	return <IconButton icon={icon} label={label} data-testid={testid} onClick={onClick} />;
}

function FilePreview({ path, before }: { path: string; before: string | undefined }) {
	const t = useT();
	const host = useOptionalResourceHost();
	const workspaceId = useResourceScope()?.workspaceId;
	const [rendererId, setRendererId] = useState<string | undefined>(undefined);
	const [layout, setLayout] = useState<ResourcePreviewLayout>("split");
	const [viewState, setViewState] = useState<unknown>(undefined);
	const [fullscreen, setFullscreen] = useState(false);
	if (!host || !workspaceId) return null;
	const openTab = () =>
		before === undefined
			? host.openFile(workspaceId, path, { keep: true })
			: host.openComparison(workspaceId, before, path);
	const openTabAction = (
		<CardAction
			testid="tool-visualize-open-tab"
			label={t(before === undefined ? "visualize.file.openInTab" : "visualize.file.openDiffInTab")}
			icon={OpenTab}
			onClick={openTab}
		/>
	);
	const shared = {
		path,
		before,
		rendererId,
		onRendererId: setRendererId,
		viewState,
		onViewState: setViewState,
	};
	return (
		<>
			<ResourcePreview
				{...shared}
				className="h-[480px] rounded-sm border border-border-default"
				actions={
					<>
						{openTabAction}
						<CardAction
							testid="tool-visualize-fullscreen"
							label={t("visualize.file.fullScreen")}
							icon={Fullscreen}
							onClick={() => setFullscreen(true)}
						/>
					</>
				}
			/>
			<Dialog open={fullscreen} onOpenChange={setFullscreen}>
				<DialogContent
					data-testid="tool-visualize-fullscreen-dialog"
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-8"
				>
					<DialogHeader>
						<DialogTitle>
							{before === undefined
								? path
								: t("visualize.summary.fileComparison", { before, path })}
						</DialogTitle>
					</DialogHeader>
					{fullscreen ? (
						<ResourcePreview
							{...shared}
							layout={layout}
							onLayout={setLayout}
							className="min-h-0 flex-1 rounded-sm border border-border-default"
							actions={openTabAction}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</>
	);
}

export function FileCard({ args, status, onOpenFile }: ToolRenderProps) {
	const t = useT();
	const title = strArg(args, "title");
	const path = strArg(args, "path");
	const before = strArg(args, "before") || undefined;

	if (!path || status !== "done") {
		return (
			<span className="text-text-muted tr-text-metadata italic">
				{status === "running" ? t("visualize.file.rendering") : t("visualize.file.empty")}
			</span>
		);
	}
	return (
		<div data-testid="tool-visualize-file" className="flex flex-col gap-4">
			{title ? <div className="tr-title-compact text-text-default">{title}</div> : null}
			<div className="flex flex-wrap items-center gap-4 text-text-muted tr-text-metadata">
				{before ? (
					<>
						<FileLink path={before} onOpenFile={onOpenFile} />
						<span aria-hidden>→</span>
					</>
				) : null}
				<FileLink path={path} onOpenFile={onOpenFile} />
			</div>
			<FilePreview path={path} before={before} />
		</div>
	);
}
