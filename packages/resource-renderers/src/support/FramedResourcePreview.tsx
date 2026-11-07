import { RiFullscreenLine as Fullscreen, RiArrowRightUpLine as OpenTab } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { useOptionalResourceHost, useResourceScope } from "../host";
import { ResourcePreview, type ResourcePreviewLayout } from "./ResourcePreview";

export interface FramedResourcePreviewProps {
	path: string;
	before?: string | undefined;
	title: string;
	frameClassName: string;
	compact?: boolean | undefined;
	testIdPrefix: string;
}

export function FramedResourcePreview({
	path,
	before,
	title,
	frameClassName,
	compact,
	testIdPrefix,
}: FramedResourcePreviewProps) {
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
		<IconButton
			icon={OpenTab}
			label={t(before === undefined ? "viewer.preview.openInTab" : "viewer.preview.openDiffInTab")}
			data-testid={`${testIdPrefix}-open-tab`}
			tabIndex={0}
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
				compact={compact}
				className={cn("rounded-sm border border-border-default", frameClassName)}
				actions={
					<>
						{openTabAction}
						<IconButton
							icon={Fullscreen}
							label={t("viewer.preview.fullScreen")}
							data-testid={`${testIdPrefix}-fullscreen`}
							tabIndex={0}
							onClick={() => setFullscreen(true)}
						/>
					</>
				}
			/>
			<Dialog open={fullscreen} onOpenChange={setFullscreen}>
				<DialogContent
					data-testid={`${testIdPrefix}-fullscreen-dialog`}
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-8"
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
					</DialogHeader>
					{fullscreen ? (
						<ResourcePreview
							{...shared}
							compact={false}
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
