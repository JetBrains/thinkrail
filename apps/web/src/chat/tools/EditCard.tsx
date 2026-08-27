import { RiPencilLine as Pencil } from "@remixicon/react";
import type { ToolRenderProps } from "../toolRegistry";
import { Collapsible } from "./Collapsible";
import { ToolFileLink } from "./ToolFileLink";
import { resultText, strArg } from "./toolHelpers";

export function EditCard({ args, result, status, workspaceRoot, onOpenFile }: ToolRenderProps) {
	const path = strArg(args, "path");
	const oldText = strArg(args, "oldText") || strArg(args, "old_string") || strArg(args, "old");
	const newText = strArg(args, "newText") || strArg(args, "new_string") || strArg(args, "new");
	const message = resultText(result);

	if (status === "error") {
		return (
			<div data-testid="tool-edit" className="flex flex-col gap-4">
				<EditHeader
					path={path}
					workspaceRoot={workspaceRoot}
					onOpenFile={onOpenFile}
					disabled={true}
				/>
				<pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">{message}</pre>
			</div>
		);
	}

	const oldLines = oldText ? oldText.split("\n") : [];
	const newLines = newText ? newText.split("\n") : [];

	return (
		<div data-testid="tool-edit" className="flex flex-col gap-4">
			<EditHeader
				path={path}
				workspaceRoot={workspaceRoot}
				onOpenFile={onOpenFile}
				disabled={status !== "done"}
			/>
			<Collapsible
				lines={oldLines.length + newLines.length}
				fadeClass="bg-[linear-gradient(to_top,var(--container-elevated-bg),transparent)]"
			>
				<div className="overflow-auto rounded-[var(--radius-sm)] border border-border-default tr-code-text leading-relaxed">
					{oldLines.map((line, i) => {
						const key = `old-${i}`;
						return (
							<div key={key} className="flex bg-feedback-error-subtle">
								<span className="w-24 shrink-0 select-none px-4 text-right text-feedback-error-muted">
									−
								</span>
								<pre className="min-w-0 flex-1 px-4 text-feedback-error tr-code-text">{line}</pre>
							</div>
						);
					})}
					{newLines.map((line, i) => {
						const key = `new-${i}`;
						return (
							<div key={key} className="flex bg-feedback-success-subtle">
								<span className="w-24 shrink-0 select-none px-4 text-right text-feedback-success-muted">
									+
								</span>
								<pre className="min-w-0 flex-1 px-4 text-feedback-success tr-code-text">{line}</pre>
							</div>
						);
					})}
				</div>
			</Collapsible>
		</div>
	);
}

function EditHeader({
	path,
	workspaceRoot,
	onOpenFile,
	disabled,
}: {
	path: string;
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
	disabled: boolean;
}) {
	return (
		<div className="flex items-center gap-4 tr-text-metadata">
			<Pencil className="size-12 shrink-0 text-feedback-warning" />
			<ToolFileLink
				path={path}
				workspaceRoot={workspaceRoot}
				onOpenFile={onOpenFile}
				disabled={disabled}
				className="text-text-default"
			/>
			<span className="shrink-0 text-text-muted">edited</span>
		</div>
	);
}
