import { resultText, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { outputFileIcon, outputFileLabel } from "@thinkrail/resource-renderers";
import { readPresentedFiles } from "./presented";

function FileCard({
	path,
	onOpenFile,
}: {
	path: string;
	onOpenFile: ToolRenderProps["onOpenFile"];
}) {
	const t = useT();
	const { name, type } = outputFileLabel(path);
	const Icon = outputFileIcon(path);
	return (
		<button
			type="button"
			data-testid="tool-present-file"
			data-path={path}
			title={path}
			disabled={!onOpenFile}
			onClick={() => onOpenFile?.(path)}
			className="flex w-full min-w-0 items-center gap-12 rounded-md border border-border-default bg-container-elevated-bg px-12 py-8 text-left enabled:cursor-pointer enabled:hover:bg-control-bg-hovered focus-visible:focus-ring"
		>
			<span className="flex size-32 shrink-0 items-center justify-center rounded-sm bg-control-bg">
				<Icon className="size-16 text-text-muted" />
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate tr-text-ui text-text-default">{name}</span>
				<span className="tr-text-metadata text-text-muted">
					{type ?? t("resources.outputFile.type")}
				</span>
			</span>
		</button>
	);
}

export function PresentedFiles({ args, result, status, onOpenFile }: ToolRenderProps) {
	const t = useT();
	if (status === "error") {
		return (
			<pre
				data-testid="tool-present-files"
				data-status="error"
				className="overflow-auto whitespace-pre-wrap px-8 py-4 text-feedback-error tr-code-text"
			>
				{resultText(result) || t("outputs.failed")}
			</pre>
		);
	}
	if (status === "running") {
		return (
			<p
				data-testid="tool-present-files"
				data-status="running"
				className="text-text-muted tr-text-metadata italic"
			>
				{t("outputs.publishing")}
			</p>
		);
	}
	return (
		<div
			data-testid="tool-present-files"
			data-status={status}
			className="flex max-w-[480px] flex-col gap-8"
		>
			{readPresentedFiles(args, result).map((path) => (
				<FileCard key={path} path={path} onOpenFile={onOpenFile} />
			))}
		</div>
	);
}
