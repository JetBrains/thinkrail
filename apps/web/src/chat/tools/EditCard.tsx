import { Pencil } from "lucide-react";
import { projectRelativePath } from "@/lib";
import type { ToolRenderProps } from "../toolRegistry";
import { Collapsible } from "./Collapsible";
import { resultText, strArg } from "./toolHelpers";

/** Body for the `edit` tool: a simple removed/added line diff. */
export function EditCard({ args, result, status, workspaceRoot }: ToolRenderProps) {
	const path = strArg(args, "path");
	// pi's edit arg names can vary; fall back across the common variants.
	const oldText = strArg(args, "oldText") || strArg(args, "old_string") || strArg(args, "old");
	const newText = strArg(args, "newText") || strArg(args, "new_string") || strArg(args, "new");
	const message = resultText(result);

	if (status === "error") {
		return (
			<div data-testid="tool-edit" className="flex flex-col gap-xs">
				<EditHeader path={path} workspaceRoot={workspaceRoot} />
				<pre className="overflow-auto px-sm py-xs text-feedback-error tr-code-text">{message}</pre>
			</div>
		);
	}

	const oldLines = oldText ? oldText.split("\n") : [];
	const newLines = newText ? newText.split("\n") : [];

	return (
		<div data-testid="tool-edit" className="flex flex-col gap-xs">
			<EditHeader path={path} workspaceRoot={workspaceRoot} />
			<Collapsible
				lines={oldLines.length + newLines.length}
				fadeClass="bg-[linear-gradient(to_top,var(--container-elevated-bg),transparent)]"
			>
				<div className="overflow-auto rounded-[var(--radius-sm)] border border-border-default tr-code-text leading-relaxed">
					{oldLines.map((line, i) => {
						// Diff lines are render-order-stable (never reordered), so the index is a correct key.
						const key = `old-${i}`;
						return (
							<div key={key} className="flex bg-feedback-error-subtle">
								<span className="w-6 shrink-0 select-none px-1 text-right text-feedback-error-muted">
									−
								</span>
								<pre className="min-w-0 flex-1 px-1 text-feedback-error tr-code-text">{line}</pre>
							</div>
						);
					})}
					{newLines.map((line, i) => {
						const key = `new-${i}`;
						return (
							<div key={key} className="flex bg-feedback-success-subtle">
								<span className="w-6 shrink-0 select-none px-1 text-right text-feedback-success-muted">
									+
								</span>
								<pre className="min-w-0 flex-1 px-1 text-feedback-success tr-code-text">{line}</pre>
							</div>
						);
					})}
				</div>
			</Collapsible>
		</div>
	);
}

function EditHeader({ path, workspaceRoot }: { path: string; workspaceRoot?: string | undefined }) {
	const displayPath = projectRelativePath(path, workspaceRoot);
	return (
		<div className="flex items-center gap-xs tr-text-metadata">
			<Pencil className="size-3.5 shrink-0 text-feedback-warning" />
			<span className="truncate text-text-default" title={path}>
				{displayPath}
			</span>
			<span className="shrink-0 text-text-muted">edited</span>
		</div>
	);
}
