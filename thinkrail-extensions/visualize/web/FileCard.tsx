import { RiFullscreenLine as Fullscreen, RiArrowRightUpLine as OpenTab } from "@remixicon/react";
import { strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import {
	canonicalWorkspacePath,
	ResourcePreview,
	type ResourcePreviewLayout,
	useOptionalResourceHost,
	useResourceScope,
} from "@thinkrail/resource-renderers";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { type ReactNode, useState } from "react";

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
	onClick,
	children,
}: {
	testid: string;
	label: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<IconTooltip label={label}>
			<button
				type="button"
				data-testid={testid}
				aria-label={label}
				onClick={onClick}
				className="flex size-24 items-center justify-center rounded-sm text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
			>
				{children}
			</button>
		</IconTooltip>
	);
}

function FilePreview({ path, before }: { path: string; before: string | undefined }) {
	const host = useOptionalResourceHost();
	const workspaceId = useResourceScope()?.workspaceId;
	const [rendererId, setRendererId] = useState<string | undefined>(undefined);
	const [layout, setLayout] = useState<ResourcePreviewLayout>("split");
	const [fullscreen, setFullscreen] = useState(false);
	if (!host || !workspaceId) return null;
	const openTab = () =>
		before === undefined
			? host.openFile(workspaceId, canonicalWorkspacePath(path), { keep: true })
			: host.openComparison(
					workspaceId,
					canonicalWorkspacePath(before),
					canonicalWorkspacePath(path),
				);
	const openTabAction = (
		<CardAction
			testid="tool-visualize-open-tab"
			label={before === undefined ? "Open in tab" : "Open diff in tab"}
			onClick={openTab}
		>
			<OpenTab className="size-14" />
		</CardAction>
	);
	const shared = { path, before, rendererId, onRendererId: setRendererId };
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
							label="Full screen"
							onClick={() => setFullscreen(true)}
						>
							<Fullscreen className="size-14" />
						</CardAction>
					</>
				}
			/>
			<Dialog open={fullscreen} onOpenChange={setFullscreen}>
				<DialogContent
					data-testid="tool-visualize-fullscreen-dialog"
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-8"
				>
					<DialogHeader>
						<DialogTitle>{before === undefined ? path : `${before} → ${path}`}</DialogTitle>
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
	const title = strArg(args, "title");
	const path = strArg(args, "path");
	const before = strArg(args, "before") || undefined;

	if (!path || status !== "done") {
		return (
			<span className="text-text-muted tr-text-metadata italic">
				{status === "running" ? "Rendering…" : "(no file)"}
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
