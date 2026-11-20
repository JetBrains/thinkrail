import { extensionLayoutToolId } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { useEffect } from "react";
import { extensionViews, findExtensionView, type RegisteredView } from "../extensions";
import { toast, useAppStore } from "../store";
import { errorText } from "../transport";
import {
	collectWorkbenchCenterGroups,
	type WorkbenchFrame,
	type WorkbenchViewArrangement,
} from "./layout";
import { currentLayoutView, enterLayoutViewLocally, exitLayoutViewLocally } from "./layoutState";

const DEFAULT_LEFT_WIDTH = 0.2;
const DEFAULT_BOTTOM_HEIGHT = 0.28;

/** Where a view puts its own side tools, as the layout arranges them. */
export function viewArrangement(view: RegisteredView): WorkbenchViewArrangement {
	const { left, bottom, layout } = view.declaration;
	return {
		left: left ? extensionLayoutToolId(view.extension, left) : undefined,
		bottom: bottom ? extensionLayoutToolId(view.extension, bottom) : undefined,
		leftWidth: layout?.leftWidth ?? DEFAULT_LEFT_WIDTH,
		bottomHeight: layout?.bottomHeight ?? DEFAULT_BOTTOM_HEIGHT,
	};
}

/** The side tools a view places: they live in their view and are offered nowhere on their own. */
export function viewSideToolIds(views: readonly RegisteredView[] = extensionViews()): Set<string> {
	return new Set(
		views.flatMap((view) => {
			const { left, bottom } = viewArrangement(view);
			return [left, bottom].filter((tool) => tool !== undefined);
		}),
	);
}

/** Enters an extension's view in this window (a workspace active); a failure leaves the frame as it was. */
export function enterExtensionView(view: RegisteredView): void {
	if (!useAppStore.getState().activeWorkspaceId) return;
	try {
		enterLayoutViewLocally(view.id, viewArrangement(view));
	} catch (error) {
		toast.error(errorText(error), t("workbench.view.enterFailed"));
	}
}

/** Leaves the window's view, whichever extension's it is (even one switched off or gone). */
export function exitExtensionView(): void {
	try {
		exitLayoutViewLocally();
	} catch (error) {
		toast.error(errorText(error), t("workbench.view.exitFailed"));
	}
}

/** Before a seam shows something in the center (a chat, a file, a panel's tab): a view hides the center. */
export function leaveViewForCenter(): void {
	if (currentLayoutView()) exitExtensionView();
}

export function toggleExtensionView(view: RegisteredView): void {
	if (currentLayoutView()?.id === view.id) exitExtensionView();
	else enterExtensionView(view);
}

/** A host's `openView`: one of its own extension's views. */
export function openOwnView(extension: string, view: string): void {
	const found = findExtensionView(`${extension}:${view}`);
	if (found) enterExtensionView(found);
}

export function useActiveViewId(): string | null {
	return useAppStore((state) => state.localLayoutPreferences.layoutView?.id ?? null);
}

/** The sum of the active workspace's center navigation clocks: it grows with every center open the user asks for. */
export function centerNavigation(state: {
	activeWorkspaceId: string | null;
	workbenchFrame: WorkbenchFrame | null;
	layoutAttentionByWorkspace: Record<
		string,
		{ navigationClockByGroup: Readonly<Record<string, number>> }
	>;
}): number {
	const { activeWorkspaceId, workbenchFrame } = state;
	if (!activeWorkspaceId || !workbenchFrame) return 0;
	const clocks = state.layoutAttentionByWorkspace[activeWorkspaceId]?.navigationClockByGroup ?? {};
	return collectWorkbenchCenterGroups(workbenchFrame.center).reduce(
		(sum, group) => sum + (clocks[group.id] ?? 0),
		0,
	);
}

/**
 * The view's lifetime in the shell: a view read from a former Board mode is arranged anew once the frame
 * is ready (or left when its extension is gone), and a center open the user asks for in the active
 * workspace — the palette, a chord, a chat link — leaves the view, since the view hides the center.
 */
export function useExtensionViewLifetime(): void {
	const ready = useAppStore((state) => state.layoutStateReady);
	const migrated = useAppStore((state) =>
		state.localLayoutPreferences.layoutView?.migrated
			? state.localLayoutPreferences.layoutView.id
			: null,
	);
	useEffect(() => {
		if (!ready || migrated === null) return;
		const view = findExtensionView(migrated);
		try {
			if (view) enterLayoutViewLocally(view.id, viewArrangement(view));
			else exitLayoutViewLocally();
		} catch (error) {
			toast.error(errorText(error), t("workbench.view.enterFailed"));
		}
	}, [migrated, ready]);
	useEffect(
		() =>
			useAppStore.subscribe((state, previous) => {
				if (
					!state.localLayoutPreferences.layoutView ||
					state.activeWorkspaceId !== previous.activeWorkspaceId ||
					state.layoutAttentionByWorkspace === previous.layoutAttentionByWorkspace ||
					centerNavigation(state) <= centerNavigation(previous)
				) {
					return;
				}
				queueMicrotask(exitExtensionView);
			}),
		[],
	);
}
