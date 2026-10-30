import {
	RiArrowDownSLine as ChevronDown,
	RiExternalLinkLine as ExternalLink,
	RiLoader4Line as Loader,
	RiPlayLine as Play,
	type RemixiconComponentType,
	RiRestartLine as Restart,
	RiRobot2Line as Robot,
	RiSparklingLine as Sparkling,
	RiStopLine as Stop,
	RiTerminalBoxLine as Terminal,
	RiToolsLine as Tools,
	RiLayoutRightLine as ToolTab,
} from "@remixicon/react";
import type { Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import { type RunAction, type RunMenuItem, runActions } from "../../panels/runActions";
import { useRunHydration } from "../../panels/useRunHydration";
import { useRunRunner } from "../../panels/useRunRunner";
import { selectSupportsRun, useAppStore } from "../../store";
import { chipClass, Segment, type SplitTone, splitFrameClass, splitPartClass } from "./Segment";

function iconFor(action: RunAction): RemixiconComponentType {
	switch (action.kind) {
		case "setUp":
			return Sparkling;
		case "start":
			return action.targetId === null ? Tools : Play;
		case "restart":
			return Restart;
		case "stop":
			return Stop;
		case "open":
			return ExternalLink;
		case "showTerminal":
			return Terminal;
		case "fix":
			return Robot;
		case "openTab":
			return ToolTab;
	}
}

function actionKey(item: RunMenuItem): string {
	const { action } = item;
	switch (action.kind) {
		case "start":
			return `start:${action.targetId ?? "prepare"}:${action.prepare ? "prepare" : "plain"}`;
		case "restart":
		case "stop":
			return `${action.kind}:${action.targetId ?? "prepare"}`;
		case "showTerminal":
			return `show:${action.tabKey}`;
		default:
			return action.kind;
	}
}

function splitTone(item: RunMenuItem | null): SplitTone {
	return item?.tone === "warning" ? "warning" : item?.tone === "primary" ? "primary" : "neutral";
}

export function RunSegment({ workspace }: { workspace: Workspace }) {
	const t = useT();
	const supported = useAppStore(selectSupportsRun);
	const hostPlatform = useAppStore((state) => state.hostPlatform);
	const run = useAppStore((state) => state.runByProject[workspace.projectId]);
	const state = useAppStore((s) => s.runByWorkspace[workspace.id]);
	useRunHydration(workspace.id, workspace.projectId);
	const runner = useRunRunner(workspace.id, workspace.projectId);
	const model = runActions(t, { supported, hostPlatform, run, state });
	if (!model) return null;
	const { primary, chip, open, secondary } = model;
	const tone = splitTone(primary);
	const PrimaryIcon = primary ? iconFor(primary.action) : null;
	const live = chip?.live === true || chip?.tone === "warning";
	return (
		<Segment
			testid="scope-run-segment"
			caption={model.caption}
			className={cn("shrink-0", live ? "flex" : "hidden md:flex")}
		>
			{chip ? (
				<span data-testid="scope-run-status" className={chipClass(chip.tone)}>
					{chip.live && chip.tone !== "warning" ? (
						<span
							aria-hidden="true"
							className={cn(
								"size-6 rounded-full bg-current",
								chip.tone === "info" && "motion-safe:animate-pulse",
							)}
						/>
					) : null}
					{chip.label}
				</span>
			) : null}
			{open ? (
				<button
					type="button"
					data-testid="scope-run-open"
					className={cn(splitFrameClass("neutral"), splitPartClass("neutral"), "px-8")}
					onClick={() => runner.openUrl(open.url)}
				>
					<ExternalLink />
					<span className="hidden md:inline">{open.label}</span>
				</button>
			) : null}
			<span data-testid="scope-run-arm" className={splitFrameClass(tone)}>
				{primary && PrimaryIcon ? (
					<button
						type="button"
						data-testid="scope-run-primary"
						data-action={actionKey(primary)}
						aria-label={primary.label}
						disabled={primary.disabled === true}
						onClick={() => runner.run(primary.action)}
						className={cn(splitPartClass(tone), "px-8 tr-text-emphasis")}
					>
						{primary.action.kind === "stop" && primary.disabled ? (
							<Loader className="animate-spin" />
						) : (
							<PrimaryIcon />
						)}
						<span className="hidden md:inline">{primary.short}</span>
					</button>
				) : null}
				<DropdownMenu>
					<DropdownMenuTrigger
						data-testid="scope-run-menu"
						aria-label={t("shell.location.run.moreActions")}
						className={cn(
							splitPartClass(tone),
							primary ? "border-l border-current/20 px-2" : "px-4",
						)}
					>
						<ChevronDown />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" data-testid="scope-run-menu-content">
						{secondary.map((item) => {
							const Icon = iconFor(item.action);
							return (
								<DropdownMenuItem
									key={actionKey(item)}
									data-testid="scope-run-action"
									data-action={actionKey(item)}
									disabled={item.disabled === true}
									onSelect={() => runner.run(item.action)}
								>
									<Icon />
									<span>{item.label}</span>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			</span>
		</Segment>
	);
}
