import { strArg, type ToolRenderProps } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { FramedResourcePreview } from "@thinkrail/resource-renderers";

function FileLink({
	path,
	onOpenFile,
}: {
	path: string;
	onOpenFile: ToolRenderProps["onOpenFile"];
}) {
	if (!onOpenFile) return <span className="min-w-0 truncate text-text-default">{path}</span>;
	return (
		<button
			type="button"
			data-testid="tool-visualize-file-link"
			onClick={() => onOpenFile(path)}
			className="min-w-0 cursor-pointer truncate rounded-xs text-left text-text-default outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
		>
			{path}
		</button>
	);
}

export function FileCard({ args, status, onOpenFile }: ToolRenderProps) {
	const t = useT();
	const title = strArg(args, "title");
	const path = strArg(args, "path");
	const before = strArg(args, "before") || undefined;

	if (!path || status !== "done") {
		return (
			<span className="text-text-muted tr-text-metadata italic">
				{status === "running" ? t("visualize.file.rendering") : t("visualize.file.empty")}
			</span>
		);
	}
	return (
		<div data-testid="tool-visualize-file" className="flex flex-col gap-4">
			{title ? <div className="tr-title-compact text-text-default">{title}</div> : null}
			<div className="flex flex-wrap items-center gap-4 text-text-muted tr-text-metadata">
				{before ? (
					<>
						<FileLink path={before} onOpenFile={onOpenFile} />
						<span aria-hidden>→</span>
					</>
				) : null}
				<FileLink path={path} onOpenFile={onOpenFile} />
			</div>
			<FramedResourcePreview
				path={path}
				before={before}
				title={before ? t("visualize.summary.fileComparison", { before, path }) : path}
				frameClassName="h-[480px]"
				testIdPrefix="tool-visualize"
			/>
		</div>
	);
}
