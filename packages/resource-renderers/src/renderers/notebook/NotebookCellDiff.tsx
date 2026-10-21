import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useT } from "@thinkrail/locales/react";
import { useEffect, useMemo, useState } from "react";
import type { Size } from "../regionReview";
import { svgIntrinsicSize } from "../svg/svgDocument";
import { VisualDiff, type VisualDiffSide } from "../VisualDiff";
import { NotebookFrame, NotebookOutputItem, NotebookOutputs } from "./NotebookOutputView";
import { type NotebookCell, type NotebookOutput, notebookOutputText } from "./notebookModel";
import { buildNotebookSvgDocument, notebookImageDataUrl } from "./outputDocument";

export function NotebookSourceDiff({
	original,
	modified,
	language,
	ignoreWhitespace,
	name,
}: {
	original: string;
	modified: string;
	language?: string | undefined;
	ignoreWhitespace: boolean;
	name: string;
}) {
	const fileDiff = useMemo(
		() =>
			parseDiffFromFile(
				{ name, contents: original, ...(language ? { lang: language } : {}) },
				{ name, contents: modified, ...(language ? { lang: language } : {}) },
				{ ignoreWhitespace },
			),
		[ignoreWhitespace, language, modified, name, original],
	);
	const options = useMemo(
		() => ({
			theme: "thinkrail",
			diffStyle: "unified" as const,
			expandUnchanged: true,
			hunkSeparators: "line-info" as const,
			lineDiffType: "word" as const,
			overflow: "scroll" as const,
			disableFileHeader: true,
			parseDiffOptions: { ignoreWhitespace },
		}),
		[ignoreWhitespace],
	);
	return (
		<div className="overflow-auto bg-container-content-bg pierre-code-surface pierre-diff-surface">
			<FileDiff fileDiff={fileDiff} options={options} />
		</div>
	);
}

function imageSize(output: NotebookOutput | null): Size | null {
	return output?.kind === "image" && output.mime === "image/svg+xml"
		? svgIntrinsicSize(output.data)
		: null;
}

function OutputImage({
	output,
	onSize,
	title,
}: {
	output: Extract<NotebookOutput, { kind: "image" }>;
	onSize: (size: Size | null) => void;
	title: string;
}) {
	if (output.mime === "image/svg+xml") {
		return <NotebookFrame title={title} document={buildNotebookSvgDocument(output.data)} fill />;
	}
	return (
		<img
			src={notebookImageDataUrl(output.mime, output.data)}
			alt={title}
			className="block h-full w-full object-contain"
			onLoad={(event) =>
				onSize({
					width: event.currentTarget.naturalWidth,
					height: event.currentTarget.naturalHeight,
				})
			}
			onError={() => onSize(null)}
		/>
	);
}

function NotebookImageOutputDiff({
	original,
	modified,
	stamp,
}: {
	original: Extract<NotebookOutput, { kind: "image" }> | null;
	modified: Extract<NotebookOutput, { kind: "image" }> | null;
	stamp: string;
}) {
	const t = useT();
	const [originalSize, setOriginalSize] = useState<Size | null>(() => imageSize(original));
	const [modifiedSize, setModifiedSize] = useState<Size | null>(() => imageSize(modified));
	useEffect(() => setOriginalSize(imageSize(original)), [original]);
	useEffect(() => setModifiedSize(imageSize(modified)), [modified]);
	const originalSide: VisualDiffSide = {
		present: original !== null,
		content: original ? (
			<OutputImage
				output={original}
				onSize={setOriginalSize}
				title={t("viewer.notebook.originalOutput")}
			/>
		) : null,
		caption: t("viewer.side.oldCaption", {
			detail: original ? original.mime : t("viewer.notebook.noOutput"),
		}),
		intrinsicSize: originalSize,
	};
	const modifiedSide: VisualDiffSide = {
		present: modified !== null,
		content: modified ? (
			<OutputImage
				output={modified}
				onSize={setModifiedSize}
				title={t("viewer.notebook.modifiedOutput")}
			/>
		) : null,
		caption: t("viewer.side.newCaption", {
			detail: modified ? modified.mime : t("viewer.notebook.noOutput"),
		}),
		intrinsicSize: modifiedSize,
	};
	return (
		<VisualDiff
			prefix="image"
			noun="output"
			selectionKey="output region"
			commentLabel={t("viewer.region.commentOnOutputRegion")}
			original={originalSide}
			modified={modifiedSide}
			contentStamp={stamp}
			initialMode="2-up"
		/>
	);
}

function OutputSide({ output, side }: { output: NotebookOutput | null; side: "old" | "new" }) {
	const t = useT();
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<span className="tr-text-metadata text-text-muted">
				{t(side === "old" ? "viewer.side.old" : "viewer.side.new")}
			</span>
			<div className="min-h-40 border border-border-muted bg-container-content-bg">
				{output ? (
					<NotebookOutputItem
						output={output}
						title={t(side === "old" ? "viewer.notebook.oldOutput" : "viewer.notebook.newOutput")}
					/>
				) : (
					<div className="flex min-h-40 items-center justify-center tr-text-ui text-text-muted">
						{t("viewer.notebook.noOutput")}
					</div>
				)}
			</div>
		</div>
	);
}

function outputNeedsSideBySide(output: NotebookOutput | null): boolean {
	return output?.kind === "html" || output?.kind === "json" || output?.kind === "image";
}

export function NotebookOutputsDiff({
	original,
	modified,
	ignoreWhitespace,
	stamp,
}: {
	original: NotebookCell;
	modified: NotebookCell;
	ignoreWhitespace: boolean;
	stamp: string;
}) {
	if (JSON.stringify(original.outputs) === JSON.stringify(modified.outputs)) {
		return modified.outputs.length > 0 ? <NotebookOutputs cell={modified} /> : null;
	}
	const count = Math.max(original.outputs.length, modified.outputs.length);
	return count > 0 ? (
		<div className="flex flex-col gap-8 border-border-muted border-t p-8">
			{Array.from({ length: count }, (_value, index) => {
				const before = original.outputs[index] ?? null;
				const after = modified.outputs[index] ?? null;
				const imagePair =
					(before === null || before.kind === "image") &&
					(after === null || after.kind === "image") &&
					(before?.kind === "image" || after?.kind === "image");
				if (imagePair) {
					return (
						<NotebookImageOutputDiff
							key={`image:${index}`}
							original={before?.kind === "image" ? before : null}
							modified={after?.kind === "image" ? after : null}
							stamp={`${stamp}:${index}`}
						/>
					);
				}
				if (outputNeedsSideBySide(before) || outputNeedsSideBySide(after)) {
					return (
						<div key={`rich:${index}`} className="grid grid-cols-1 gap-8 md:grid-cols-2">
							<OutputSide output={before} side="old" />
							<OutputSide output={after} side="new" />
						</div>
					);
				}
				return (
					<NotebookSourceDiff
						key={`text:${index}`}
						original={before ? (notebookOutputText(before) ?? "") : ""}
						modified={after ? (notebookOutputText(after) ?? "") : ""}
						ignoreWhitespace={ignoreWhitespace}
						name={`output-${index + 1}.txt`}
					/>
				);
			})}
		</div>
	) : null;
}
