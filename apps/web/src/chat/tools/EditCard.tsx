import { Pencil } from "lucide-react";
import type { ToolRenderProps } from "../toolRegistry";
import { Collapsible } from "./Collapsible";
import { fileName, resultText, strArg } from "./toolHelpers";

/** Body for the `edit` tool: a simple removed/added line diff. */
export function EditCard({ args, result, status }: ToolRenderProps) {
	const path = strArg(args, "path");
	// pi's edit arg names can vary; fall back across the common variants.
	const oldText = strArg(args, "oldText") || strArg(args, "old_string") || strArg(args, "old");
	const newText = strArg(args, "newText") || strArg(args, "new_string") || strArg(args, "new");
	const message = resultText(result);

	if (status === "error") {
		return (
			<div data-testid="tool-edit" className="flex flex-col gap-xs">
				<EditHeader path={path} />
				<pre className="overflow-auto px-sm py-xs text-red text-xs">{message}</pre>
			</div>
		);
	}

	const oldLines = oldText ? oldText.split("\n") : [];
	const newLines = newText ? newText.split("\n") : [];

	return (
		<div data-testid="tool-edit" className="flex flex-col gap-xs">
			<EditHeader path={path} />
			<Collapsible
				lines={oldLines.length + newLines.length}
				fadeClass="bg-[linear-gradient(to_top,var(--elevated),transparent)]"
			>
				<div className="overflow-auto rounded-[var(--radius-sm)] border border-border2 font-[var(--font-mono)] text-xs leading-relaxed">
					{oldLines.map((line, i) => {
						// Diff lines are render-order-stable (never reordered), so the index is a correct key.
						const key = `old-${i}`;
						return (
							<div key={key} className="flex bg-red/10">
								<span className="w-6 shrink-0 select-none px-1 text-right text-red/50">−</span>
								<pre className="min-w-0 flex-1 px-1 text-red">{line}</pre>
							</div>
						);
					})}
					{newLines.map((line, i) => {
						const key = `new-${i}`;
						return (
							<div key={key} className="flex bg-green/10">
								<span className="w-6 shrink-0 select-none px-1 text-right text-green/50">+</span>
								<pre className="min-w-0 flex-1 px-1 text-green">{line}</pre>
							</div>
						);
					})}
				</div>
			</Collapsible>
		</div>
	);
}

function EditHeader({ path }: { path: string }) {
	return (
		<div className="flex items-center gap-xs text-xs">
			<Pencil className="size-3.5 shrink-0 text-gold" />
			<span className="truncate text-text" title={path}>
				{fileName(path)}
			</span>
			<span className="shrink-0 text-hint">edited</span>
		</div>
	);
}
