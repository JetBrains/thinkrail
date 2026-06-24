import { X } from "lucide-react";
import { lazy, Suspense } from "react";
import { type EditorTab, useAppStore } from "../store";

// Monaco is heavy — load it only once a file is actually opened (protects first paint + the bundle).
const MonacoEditor = lazy(() => import("./MonacoEditor"));

// Stable empty reference so the selector doesn't re-render the component on unrelated state changes.
const NO_TABS: EditorTab[] = [];

/** The center area: a strip of the active workspace's tabs over the active tab. Chat tabs join at M11. */
export function CenterTabs() {
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const tabsByWorkspace = useAppStore((s) => s.tabsByWorkspace);
	const activeTabByWorkspace = useAppStore((s) => s.activeTabByWorkspace);
	const setActiveTab = useAppStore((s) => s.setActiveTab);
	const closeTab = useAppStore((s) => s.closeTab);

	const openTabs = activeWorkspaceId ? (tabsByWorkspace[activeWorkspaceId] ?? NO_TABS) : NO_TABS;
	const activeTabId = activeWorkspaceId ? (activeTabByWorkspace[activeWorkspaceId] ?? null) : null;

	if (openTabs.length === 0) {
		return (
			<div className="flex h-full items-center justify-center text-hint">
				Open a file or start a chat
			</div>
		);
	}

	const active = openTabs.find((t) => t.id === activeTabId) ?? null;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				role="tablist"
				className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border2 bg-bg-dark"
			>
				{openTabs.map((tab) => {
					const isActive = tab.id === activeTabId;
					return (
						<div
							key={tab.id}
							data-testid="editor-tab"
							data-active={isActive}
							className={`group flex items-center gap-xs border-r border-border2 pl-sm pr-xs text-sm ${
								isActive ? "bg-bg text-text" : "text-muted hover:bg-hover"
							}`}
						>
							<button
								type="button"
								className="max-w-[160px] truncate py-xs"
								onClick={() => setActiveTab(tab.id)}
							>
								{tab.name}
							</button>
							<button
								type="button"
								data-testid="editor-tab-close"
								aria-label={`Close ${tab.name}`}
								onClick={() => closeTab(tab.id)}
								className="rounded-[var(--radius-sm)] p-0.5 text-hint opacity-0 hover:bg-hover hover:text-text group-hover:opacity-100"
							>
								<X className="size-3.5" />
							</button>
						</div>
					);
				})}
			</div>
			<div data-testid="editor-pane" className="min-h-0 flex-1">
				{active && (
					<Suspense
						fallback={
							<div className="flex h-full items-center justify-center text-hint">
								Loading editor…
							</div>
						}
					>
						<MonacoEditor key={active.id} path={active.path} content={active.content} />
					</Suspense>
				)}
			</div>
		</div>
	);
}
