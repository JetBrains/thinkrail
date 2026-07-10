import { lazy, Suspense } from "react";
import { isMarkdownPath } from "@/lib/utils";
import type { FileTab } from "../store";
import { useAppStore } from "../store";

// Heavy views load only when shown: Monaco for source, markdown+shiki for the rendered preview.
const MonacoEditor = lazy(() => import("./MonacoEditor"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

const loading = <div className="flex h-full items-center justify-center text-hint">Loading…</div>;

/**
 * The center pane for a file tab. Non-markdown files render Monaco directly (unchanged). Markdown files
 * open **rendered by default** with a `Preview | Source` toggle in a slim header; the choice lives on the
 * tab (`store.setFileTabView`) so it survives tab switches.
 */
export function FilePane({ tab }: { tab: FileTab }) {
	const setFileTabView = useAppStore((s) => s.setFileTabView);

	if (!isMarkdownPath(tab.path)) {
		return (
			<Suspense fallback={loading}>
				<MonacoEditor path={tab.path} content={tab.content} />
			</Suspense>
		);
	}

	const view = tab.view ?? "rendered";
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="markdown-view-toggle"
				role="toolbar"
				aria-label="Markdown view mode"
				className="flex h-8 shrink-0 items-center gap-xs border-border2 border-b bg-bg-dark px-sm"
			>
				<ToggleSegment
					testid="md-toggle-preview"
					label="Preview"
					active={view === "rendered"}
					onClick={() => setFileTabView(tab.id, "rendered")}
				/>
				<ToggleSegment
					testid="md-toggle-source"
					label="Source"
					active={view === "source"}
					onClick={() => setFileTabView(tab.id, "source")}
				/>
			</div>
			<div className="min-h-0 flex-1">
				<Suspense fallback={loading}>
					{view === "rendered" ? (
						<MarkdownPreview content={tab.content} workspaceId={tab.workspaceId} path={tab.path} />
					) : (
						<MonacoEditor path={tab.path} content={tab.content} />
					)}
				</Suspense>
			</div>
		</div>
	);
}

function ToggleSegment({
	testid,
	label,
	active,
	onClick,
}: {
	testid: string;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			data-testid={testid}
			data-active={active}
			aria-pressed={active}
			className={`rounded-[var(--radius-sm)] px-sm py-0.5 text-xs ${
				active ? "bg-elevated text-text" : "text-hint hover:bg-hover hover:text-text"
			}`}
			onClick={onClick}
		>
			{label}
		</button>
	);
}
