import {
	RiCodeSSlashLine as CodeGlyph,
	RiFlowChart as DiagramGlyph,
	RiGitPullRequestLine as DiffGlyph,
	RiHtml5Line as HtmlGlyph,
	RiImageLine as ImageGlyph,
	RiMarkdownLine as MarkdownFileGlyph,
	RiArrowRightUpLine as OpenTab,
	type RemixiconComponentType,
	RiFileTextLine as TextGlyph,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import type { AskUserQuestionPreviewFields } from "@thinkrail/pi-ask-user-question/core";
import {
	FramedResourcePreview,
	useOptionalResourceHost,
	useResourceScope,
} from "@thinkrail/resource-renderers";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useLayoutEffect, useRef, useState } from "react";
import { useGhostPage, useTestId } from "./ghost";

export type PreviewSource =
	| { kind: "markdown"; text: string; diagram: boolean }
	| { kind: "file"; path: string; before?: string | undefined };

export function previewSource(target: AskUserQuestionPreviewFields): PreviewSource | null {
	if (target.previewFile)
		return { kind: "file", path: target.previewFile, before: target.previewBefore };
	const text = target.preview?.trim();
	if (!text) return null;
	return { kind: "markdown", text, diagram: /^\s*```mermaid\b/m.test(text) };
}

const FILE_GLYPHS: Array<[RegExp, RemixiconComponentType]> = [
	[/\.html?$/i, HtmlGlyph],
	[/\.(?:svg|png|jpe?g|gif|webp|avif|bmp|ico)$/i, ImageGlyph],
	[/\.(?:md|markdown|mdx)$/i, MarkdownFileGlyph],
];

export function previewGlyph(source: PreviewSource): RemixiconComponentType {
	if (source.kind === "markdown") return source.diagram ? DiagramGlyph : TextGlyph;
	if (source.before !== undefined) return DiffGlyph;
	return FILE_GLYPHS.find(([pattern]) => pattern.test(source.path))?.[1] ?? CodeGlyph;
}

export function PreviewGlyph({ source }: { source: PreviewSource }) {
	const Icon = previewGlyph(source);
	return <Icon aria-hidden="true" className="size-14 shrink-0" />;
}

function PreviewMarkdown({ text }: { text: string }) {
	const Markdown = useOptionalResourceHost()?.markdown;
	if (Markdown) return <Markdown text={text} />;
	return <pre className="whitespace-pre-wrap tr-text-ui text-text-default">{text}</pre>;
}

function fileTitle(source: Extract<PreviewSource, { kind: "file" }>): string {
	return source.before === undefined ? source.path : `${source.before} → ${source.path}`;
}

function FileFrame({
	source,
	onOpenFile,
}: {
	source: Extract<PreviewSource, { kind: "file" }>;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const t = useT();
	const tid = useTestId();
	const ghost = useGhostPage();
	const host = useOptionalResourceHost();
	const workspaceId = useResourceScope()?.workspaceId;
	if (ghost) return <div className="h-full rounded-sm border border-border-default" />;
	if (!host || !workspaceId) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-8 rounded-sm border border-border-default border-dashed px-12 text-center">
				<span className="min-w-0 break-all text-text-muted tr-text-metadata">
					{fileTitle(source)}
				</span>
				{onOpenFile ? (
					<Button
						variant="outline"
						size="s"
						iconLeft={OpenTab}
						tabIndex={0}
						data-testid={tid("ask-preview-open-file")}
						onClick={() => onOpenFile(source.path)}
					>
						{t("tools.ask.openPreviewFile")}
					</Button>
				) : null}
			</div>
		);
	}
	return (
		<FramedResourcePreview
			path={source.path}
			before={source.before}
			title={fileTitle(source)}
			frameClassName="h-full"
			compact
			testIdPrefix="ask-preview"
		/>
	);
}

const FOLD = "max-h-[240px]";
const FOLD_HEIGHT = 240;

function FoldedMarkdown({
	text,
	diagram,
	expanded,
	onToggleExpanded,
}: {
	text: string;
	diagram: boolean;
	expanded: boolean;
	onToggleExpanded: () => void;
}) {
	const t = useT();
	const tid = useTestId();
	const ghost = useGhostPage();
	const contentRef = useRef<HTMLDivElement>(null);
	const [overflows, setOverflows] = useState(diagram);

	useLayoutEffect(() => {
		const content = contentRef.current;
		if (!content || diagram) return;
		const measure = () => setOverflows(content.offsetHeight > FOLD_HEIGHT - 1);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, [diagram]);

	const toggle =
		overflows || expanded ? (
			<Button
				variant="outline"
				size="s"
				tabIndex={0}
				data-testid={tid("ask-question-preview-toggle")}
				aria-expanded={expanded}
				onClick={onToggleExpanded}
				className={cn(!expanded && "absolute right-8 bottom-8")}
			>
				{expanded ? t("tools.ask.previewShowLess") : t("tools.ask.previewShowAll")}
			</Button>
		) : null;
	return (
		<div
			className={cn(
				"relative overflow-hidden rounded-sm border border-border-default bg-container-content-bg",
				diagram && !expanded ? "h-[240px]" : !expanded && FOLD,
			)}
		>
			<div ref={contentRef} className="px-12 py-8">
				{diagram && ghost ? null : <PreviewMarkdown text={text} />}
			</div>
			{expanded ? <div className="flex justify-end px-12 pb-8">{toggle}</div> : toggle}
		</div>
	);
}

export function QuestionPreview({
	source,
	expanded,
	onToggleExpanded,
	onOpenFile,
}: {
	source: PreviewSource;
	expanded: boolean;
	onToggleExpanded: () => void;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const t = useT();
	const tid = useTestId();
	return (
		<div
			data-ask-preview=""
			data-testid={tid("ask-question-preview")}
			className="flex flex-col gap-4"
		>
			<div className="flex min-w-0 items-center gap-4 text-text-muted tr-text-metadata">
				<PreviewGlyph source={source} />
				<span className="shrink-0">{t("tools.ask.questionPreview")}</span>
				{source.kind === "file" ? (
					<span className="min-w-0 truncate text-text-subtle">{fileTitle(source)}</span>
				) : null}
			</div>
			{source.kind === "markdown" ? (
				<FoldedMarkdown
					text={source.text}
					diagram={source.diagram}
					expanded={expanded}
					onToggleExpanded={onToggleExpanded}
				/>
			) : (
				<div className="h-[240px]">
					<FileFrame source={source} onOpenFile={onOpenFile} />
				</div>
			)}
		</div>
	);
}

export function OptionPreviewPane({
	label,
	source,
	scrollRef,
	onOpenFile,
}: {
	label: string | null;
	source: PreviewSource | null;
	scrollRef: (node: HTMLDivElement | null) => void;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const t = useT();
	const tid = useTestId();
	const ghost = useGhostPage();
	return (
		<div
			data-ask-preview=""
			data-testid={tid("ask-preview")}
			data-preview={source?.kind ?? "none"}
			className="flex h-[380px] min-w-0 flex-col gap-4"
		>
			<div className="flex min-h-20 min-w-0 items-center gap-4 text-text-muted tr-text-metadata">
				{source ? <PreviewGlyph source={source} /> : null}
				{label ? <span className="shrink-0">{t("tools.ask.preview", { label })}</span> : null}
				{source?.kind === "file" ? (
					<span className="min-w-0 truncate text-text-subtle">{fileTitle(source)}</span>
				) : null}
			</div>
			<div className="min-h-0 flex-1">
				{ghost ? (
					<div className="h-full rounded-sm border border-border-default" />
				) : !source ? (
					<div
						data-testid={tid("ask-preview-none")}
						className="flex h-full items-center justify-center rounded-sm border border-border-default border-dashed px-12 text-center text-text-muted tr-text-metadata"
					>
						{t("tools.ask.noPreview")}
					</div>
				) : source.kind === "markdown" ? (
					<div
						ref={scrollRef}
						data-testid={tid("ask-preview-scroll")}
						className="h-full overflow-auto rounded-sm border border-border-default bg-container-content-bg px-12 py-8"
					>
						<PreviewMarkdown text={source.text} />
					</div>
				) : (
					<FileFrame key={fileTitle(source)} source={source} onOpenFile={onOpenFile} />
				)}
			</div>
		</div>
	);
}
