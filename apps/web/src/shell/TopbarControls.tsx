import {
	RiLayoutRightFill,
	RiLayoutRightLine,
	RiSideBarFill,
	RiSideBarLine,
	RiTerminalBoxFill,
	RiTerminalBoxLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { useGitStatus } from "../panels/useGitStatus";
import { useAppStore } from "../store";
import { useKeybindingLabel } from "./keybindingState";

/**
 * The Codex-style top bar's leading control: one toggle for the Thread Sidebar (the Projects tool in a
 * workspace, the Projects pane on Project Home). It is a component, not inline header JSX, so the
 * header's own action cluster keeps owning the no-drag boundary; its root opts out of dragging itself.
 */
export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
	const t = useT();
	const shortcut = useKeybindingLabel("view.toggleLeft");
	const label = open ? t("shell.topbar.hideSidebar") : t("shell.topbar.showSidebar");
	return (
		<div className="window-no-drag flex shrink-0 items-center">
			<IconButton
				variant="ghost"
				size="m"
				icon={open ? RiSideBarFill : RiSideBarLine}
				label={label}
				tooltip={label}
				tooltipShortcut={shortcut ? [shortcut] : undefined}
				selected={open}
				aria-pressed={open}
				data-testid="toggle-sidebar"
				onClick={onToggle}
			/>
		</div>
	);
}

function useSideVisible(side: "right" | "bottom"): boolean {
	return useAppStore((s) => s.workbenchFrame?.[side].visible ?? false);
}

/** Sum of the active workspace's changed lines, or `null` while unknown / for a chat. */
function useDiffTotals(workspaceId: string | null): { added: number; removed: number } | null {
	const { status } = useGitStatus(workspaceId);
	if (!status) return null;
	let added = 0;
	let removed = 0;
	for (const change of status.changes) {
		added += change.added ?? 0;
		removed += change.removed ?? 0;
	}
	return { added, removed };
}

/**
 * Review Changes: opens the right side on the Review tool, or hides the right side when it is shown.
 * It carries the workspace's `+N −M` line totals when git status is known.
 */
export function ReviewChangesButton({
	workspaceId,
	gitWorkspaceId,
	onToggle,
}: {
	workspaceId: string;
	/** `null` for a chat without a project: no git status to read. */
	gitWorkspaceId: string | null;
	onToggle: () => void;
}) {
	const t = useT();
	const open = useSideVisible("right");
	const shortcut = useKeybindingLabel("view.toggleRight");
	const totals = useDiffTotals(gitWorkspaceId);
	const hasChanges = totals !== null && (totals.added > 0 || totals.removed > 0);
	const label = open ? t("shell.topbar.hideReview") : t("shell.topbar.openReview");
	return (
		<Button
			variant="ghost"
			size="m"
			iconLeft={open ? RiLayoutRightFill : RiLayoutRightLine}
			selected={open}
			aria-pressed={open}
			aria-label={label}
			tooltip={label}
			tooltipShortcut={shortcut ? [shortcut] : undefined}
			data-testid="open-review"
			data-workspace-id={workspaceId}
			onClick={onToggle}
		>
			{hasChanges ? (
				<span className="tabular-nums">
					<span className="text-feedback-success">+{totals.added}</span>{" "}
					<span className="text-feedback-error">−{totals.removed}</span>
				</span>
			) : (
				t("shell.topbar.review")
			)}
		</Button>
	);
}

/** Terminal toggle: shows or hides the bottom panel, where the workspace's terminals live. */
export function TerminalToggle({ onToggle }: { onToggle: () => void }) {
	const t = useT();
	const open = useSideVisible("bottom");
	const shortcut = useKeybindingLabel("view.toggleBottom");
	const label = open ? t("shell.topbar.hideTerminal") : t("shell.topbar.showTerminal");
	return (
		<IconButton
			variant="ghost"
			size="m"
			icon={open ? RiTerminalBoxFill : RiTerminalBoxLine}
			label={label}
			tooltip={label}
			tooltipShortcut={shortcut ? [shortcut] : undefined}
			selected={open}
			aria-pressed={open}
			data-testid="toggle-terminal"
			onClick={onToggle}
		/>
	);
}
