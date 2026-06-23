import { X } from "lucide-react";
import { lazy, Suspense } from "react";
import { useAppStore } from "../store/appStore";

// Monaco is heavy — load it only once a file is actually opened (protects first paint + the bundle).
const MonacoEditor = lazy(() => import("./MonacoEditor"));

/** The center area: a strip of open tabs over the active tab's content. File tabs now; chat tabs at M11. */
export function CenterTabs() {
	const openTabs = useAppStore((s) => s.openTabs);
	const activeTabId = useAppStore((s) => s.activeTabId);
	const setActiveTab = useAppStore((s) => s.setActiveTab);
	const closeTab = useAppStore((s) => s.closeTab);

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
				className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-border bg-bg-dark"
			>
				{openTabs.map((tab) => {
					const isActive = tab.id === activeTabId;
					return (
						<div
							key={tab.id}
							data-testid="editor-tab"
							data-active={isActive}
							className={`group flex items-center gap-xs border-r border-border pl-sm pr-xs text-sm ${
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
