import {
	RiArrowDownSLine,
	RiCheckLine,
	RiClipboardLine,
	RiCollapseVerticalLine,
	RiEyeLine,
	RiEyeOffLine,
	RiMoreLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useLayoutEffect, useRef, useState } from "react";
import type { ArtifactsView } from "../store";
import { HeaderIconButton } from "./HeaderIconButton";

export type ToolbarFold = 0 | 1;

export function nextToolbarFold(
	fold: ToolbarFold,
	overflowing: boolean,
	available: number,
	neededToUnfold: number | undefined,
): ToolbarFold {
	if (overflowing) return 1;
	if (fold > 0 && neededToUnfold !== undefined && available >= neededToUnfold) return 0;
	return fold;
}

function useToolbarFold(contentKey: string) {
	const toolbarRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const foldRef = useRef<ToolbarFold>(0);
	const needed = useRef<number | undefined>(undefined);
	const keyRef = useRef(contentKey);
	const [fold, setFold] = useState<ToolbarFold>(0);

	useLayoutEffect(() => {
		const toolbar = toolbarRef.current;
		const content = contentRef.current;
		if (!toolbar || !content) return;
		if (keyRef.current !== contentKey) {
			keyRef.current = contentKey;
			needed.current = undefined;
			if (foldRef.current !== 0) {
				foldRef.current = 0;
				setFold(0);
				return;
			}
		}
		const refit = () => {
			const style = getComputedStyle(toolbar);
			const available =
				toolbar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
			const width = content.scrollWidth;
			const current = foldRef.current;
			const next = nextToolbarFold(current, width > available, available, needed.current);
			if (next === current) return;
			if (next > current) needed.current = width;
			foldRef.current = next;
			setFold(next);
		};
		refit();
		const observer = new ResizeObserver(refit);
		observer.observe(toolbar);
		return () => observer.disconnect();
	}, [contentKey, fold]);

	return { toolbarRef, contentRef, fold };
}

export interface ToolbarView {
	id: ArtifactsView;
	label: string;
}

function ViewMenu({
	views,
	view,
	onView,
}: {
	views: readonly ToolbarView[];
	view: ArtifactsView;
	onView: (view: ArtifactsView) => void;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const label = views.find((item) => item.id === view)?.label ?? "";
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="m"
					iconRight={RiArrowDownSLine}
					data-testid="artifacts-view"
					data-view={view}
					data-open={open}
					aria-label={t("panels.artifacts.viewMenu", { view: label })}
					className="shrink-0"
				>
					{label}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" data-testid="artifacts-view-menu">
				<DropdownMenuRadioGroup value={view}>
					{views.map((item) => (
						<DropdownMenuRadioItem
							key={item.id}
							value={item.id}
							data-testid={`artifacts-view-${item.id}`}
							data-active={view === item.id}
							className="justify-between"
							onSelect={() => onView(item.id)}
						>
							<span>{item.label}</span>
							{view === item.id ? <RiCheckLine className="text-primary" /> : null}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function ArtifactsToolbar({
	allChats,
	chatFilterDisabled,
	onAllChats,
	views,
	view,
	onView,
	canCollapse,
	onCollapseAll,
	showIgnored,
	onToggleIgnored,
	onPaste,
}: {
	allChats: boolean;
	chatFilterDisabled: boolean;
	onAllChats: (all: boolean) => void;
	views: readonly ToolbarView[];
	view: ArtifactsView;
	onView: (view: ArtifactsView) => void;
	canCollapse: boolean;
	onCollapseAll: () => void;
	showIgnored: boolean | null;
	onToggleIgnored: () => void;
	onPaste: (() => void) | null;
}) {
	const t = useT();
	const { toolbarRef, contentRef, fold } = useToolbarFold(
		[view, views.map((item) => item.id).join(","), canCollapse, showIgnored, onPaste !== null].join(
			":",
		),
	);
	const ignoredLabel = showIgnored
		? t("panels.artifacts.hideIgnored")
		: t("panels.artifacts.showIgnored");
	return (
		<div
			ref={toolbarRef}
			role="toolbar"
			aria-label={t("panels.artifacts.toolbar")}
			data-fold={fold}
			className="flex h-panel-header-row shrink-0 items-center overflow-clip border-border-default border-b px-12"
		>
			<div ref={contentRef} className="flex w-max min-w-full shrink-0 items-center gap-4">
				<ToggleSegment
					testid="artifacts-filter-all"
					label={t("panels.artifacts.allChats")}
					active={allChats}
					onClick={() => onAllChats(true)}
				/>
				<ToggleSegment
					testid="artifacts-filter-chat"
					label={t("panels.artifacts.thisChat")}
					active={!allChats}
					disabled={chatFilterDisabled}
					onClick={() => onAllChats(false)}
				/>
				<div className="ml-auto flex shrink-0 items-center gap-4">
					<ViewMenu views={views} view={view} onView={onView} />
					{fold === 0 && canCollapse ? (
						<HeaderIconButton
							testid="artifacts-collapse-all"
							label={t("panels.artifacts.collapseAll")}
							icon={RiCollapseVerticalLine}
							onClick={onCollapseAll}
						/>
					) : null}
					{fold === 0 && showIgnored !== null ? (
						<HeaderIconButton
							testid="artifacts-toggle-ignored"
							label={ignoredLabel}
							active={showIgnored}
							icon={showIgnored ? RiEyeLine : RiEyeOffLine}
							onClick={onToggleIgnored}
						/>
					) : null}
					{fold === 0 && onPaste ? (
						<HeaderIconButton
							testid="artifacts-paste"
							label={t("panels.artifacts.paste")}
							icon={RiClipboardLine}
							onClick={onPaste}
						/>
					) : null}
					{fold > 0 && (canCollapse || showIgnored !== null || onPaste) ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<IconButton
									variant="ghost"
									size="m"
									icon={RiMoreLine}
									label={t("panels.artifacts.more")}
									data-testid="artifacts-more"
									wrapTrigger
									className="shrink-0"
								/>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" data-testid="artifacts-more-menu">
								{canCollapse ? (
									<DropdownMenuItem
										data-testid="artifacts-more-collapse-all"
										onSelect={onCollapseAll}
									>
										<RiCollapseVerticalLine />
										{t("panels.artifacts.collapseAll")}
									</DropdownMenuItem>
								) : null}
								{showIgnored !== null ? (
									<DropdownMenuItem
										data-testid="artifacts-more-toggle-ignored"
										onSelect={onToggleIgnored}
									>
										{showIgnored ? <RiEyeOffLine /> : <RiEyeLine />}
										{ignoredLabel}
									</DropdownMenuItem>
								) : null}
								{onPaste ? (
									<DropdownMenuItem data-testid="artifacts-more-paste" onSelect={onPaste}>
										<RiClipboardLine />
										{t("panels.artifacts.paste")}
									</DropdownMenuItem>
								) : null}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
			</div>
		</div>
	);
}
