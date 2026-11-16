import {
	RiCodeSSlashLine as CodeGlyph,
	RiFlowChart as DiagramGlyph,
	RiGitPullRequestLine as DiffGlyph,
	RiFullscreenLine as FullscreenGlyph,
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
import { Button, IconButton } from "@thinkrail/ui/button";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { cn } from "@thinkrail/ui/utils";
import { type FocusEvent, useLayoutEffect, useRef, useState } from "react";
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

export function isHtmlSource(source: PreviewSource | null): boolean {
	return source?.kind === "file" && /\.html?$/i.test(source.path);
}

export function scrollsWithPage(source: PreviewSource | null): boolean {
	return source !== null && !isHtmlSource(source);
}

function scrollsVertically(element: HTMLElement): boolean {
	const { overflowY } = getComputedStyle(element);
	return (
		(overflowY === "auto" || overflowY === "scroll") &&
		element.scrollHeight > element.clientHeight + 1
	);
}

export function scrollPreview(pane: HTMLElement, direction: 1 | -1): boolean {
	const scroller = [pane, ...pane.querySelectorAll<HTMLElement>("*")].find(scrollsVertically);
	scroller?.scrollBy({ top: direction * 0.9 * scroller.clientHeight });
	return scroller !== undefined;
}

export function enterPreviewFrame(pane: HTMLElement | null): boolean {
	const frame = pane?.querySelector("iframe");
	if (!frame) return false;
	frame.focus();
	return true;
}

export function previewGlyph(source: PreviewSource): RemixiconComponentType {
	if (source.kind === "markdown") return source.diagram ? DiagramGlyph : TextGlyph;
	if (source.before !== undefined) return DiffGlyph;
	return FILE_GLYPHS.find(([pattern]) => pattern.test(source.path))?.[1] ?? CodeGlyph;
}

export function PreviewGlyph({ source }: { source: PreviewSource }) {
	const Icon = previewGlyph(source);
	return <Icon aria-hidden="true" className="size-14 shrink-0" />;
}

export function PreviewMarkdown({ text }: { text: string }) {
	const Markdown = useOptionalResourceHost()?.markdown;
	if (Markdown) return <Markdown text={text} />;
	return <pre className="whitespace-pre-wrap tr-text-ui text-text-default">{text}</pre>;
}

type FilePreviewSource = Extract<PreviewSource, { kind: "file" }>;

function fileTitle(source: FilePreviewSource): string {
	return source.before === undefined ? source.path : `${source.before} → ${source.path}`;
}

function FileFrame({
	source,
	onOpenFile,
	onFullscreen,
}: {
	source: FilePreviewSource;
	onOpenFile?: ((path: string) => void) | undefined;
	onFullscreen?: (() => void) | undefined;
}) {
	const ghost = useGhostPage();
	const host = useOptionalResourceHost();
	const workspaceId = useResourceScope()?.workspaceId;
	if (ghost) return <div className="h-full rounded-sm border border-border-default" />;
	if (!host || !workspaceId) return <FileUnavailable source={source} onOpenFile={onOpenFile} />;
	return (
		<FramedResourcePreview
			path={source.path}
			before={source.before}
			title={fileTitle(source)}
			frameClassName="h-full"
			compact
			frameFocus="manual"
			testIdPrefix="ask-preview"
			onFullscreen={onFullscreen}
		/>
	);
}

export function FileUnavailable({
	source,
	onOpenFile,
}: {
	source: FilePreviewSource;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const t = useT();
	const tid = useTestId();
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

function CompareButton({ onClick }: { onClick: () => void }) {
	const t = useT();
	const tid = useTestId();
	return (
		<IconButton
			icon={FullscreenGlyph}
			size="s"
			label={t("tools.ask.compare.open")}
			tabIndex={0}
			data-testid={tid("ask-compare-open")}
			onClick={onClick}
			className="ml-auto shrink-0"
		/>
	);
}

export function QuestionPreview({
	source,
	expanded,
	onToggleExpanded,
	onOpenFile,
	onFullscreen,
}: {
	source: PreviewSource;
	expanded: boolean;
	onToggleExpanded: () => void;
	onOpenFile?: ((path: string) => void) | undefined;
	onFullscreen?: (() => void) | undefined;
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
				) : onFullscreen ? (
					<CompareButton onClick={onFullscreen} />
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
					<FileFrame source={source} onOpenFile={onOpenFile} onFullscreen={onFullscreen} />
				</div>
			)}
		</div>
	);
}

export function FrameReturn({ onReturn }: { onReturn: () => void }) {
	const t = useT();
	return (
		<button
			type="button"
			tabIndex={0}
			data-testid="ask-preview-return"
			onFocus={onReturn}
			onClick={onReturn}
			className="sr-only"
		>
			{t("tools.ask.frameReturn")}
		</button>
	);
}

export function OptionPreviewPane({
	label,
	source,
	paneRef,
	interactCaps,
	onInteract,
	onReturn,
	onOpenFile,
	onFullscreen,
}: {
	label: string | null;
	source: PreviewSource | null;
	paneRef: (node: HTMLDivElement | null) => void;
	interactCaps: readonly string[];
	onInteract: () => void;
	onReturn: () => void;
	onOpenFile?: ((path: string) => void) | undefined;
	onFullscreen?: (() => void) | undefined;
}) {
	const t = useT();
	const tid = useTestId();
	const ghost = useGhostPage();
	const [inFrame, setInFrame] = useState(false);
	const html = isHtmlSource(source);
	const onFocus = (event: FocusEvent<HTMLFieldSetElement>) => {
		if (event.target instanceof HTMLIFrameElement) setInFrame(true);
	};
	const onBlur = (event: FocusEvent<HTMLFieldSetElement>) => {
		if (!event.currentTarget.contains(event.relatedTarget)) setInFrame(false);
	};
	return (
		<fieldset
			aria-label={label ? t("tools.ask.preview", { label }) : undefined}
			data-ask-preview=""
			data-testid={tid("ask-preview")}
			data-preview={source?.kind ?? "none"}
			onFocus={onFocus}
			onBlur={onBlur}
			className="m-0 flex h-[380px] min-w-0 flex-col gap-4 border-0 p-0"
		>
			<div className="flex min-h-20 min-w-0 items-center gap-4 text-text-muted tr-text-metadata">
				{source ? <PreviewGlyph source={source} /> : null}
				{label ? <span className="shrink-0">{t("tools.ask.preview", { label })}</span> : null}
				{source?.kind === "file" ? (
					<span className="min-w-0 truncate text-text-subtle">{fileTitle(source)}</span>
				) : onFullscreen && !ghost ? (
					<CompareButton onClick={onFullscreen} />
				) : null}
				{html && !ghost ? (
					inFrame ? (
						<span
							data-testid={tid("ask-preview-frame-legend")}
							className="ml-auto shrink-0 rounded-full bg-primary-subtle px-8 text-primary"
						>
							{t("tools.ask.frameLegend")}
						</span>
					) : (
						<Button
							variant="ghost"
							size="s"
							tabIndex={0}
							data-testid={tid("ask-preview-interact")}
							onClick={onInteract}
							className="ml-auto shrink-0"
						>
							{t("tools.ask.interact")}
							{interactCaps.length > 0 ? <Keycaps keys={interactCaps} /> : null}
						</Button>
					)
				) : null}
			</div>
			<div
				ref={paneRef}
				data-testid={tid("ask-preview-body")}
				className={cn("relative min-h-0 flex-1 rounded-sm", inFrame && "focus-ring")}
			>
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
						data-testid={tid("ask-preview-scroll")}
						className="h-full overflow-auto rounded-sm border border-border-default bg-container-content-bg px-12 py-8"
					>
						<PreviewMarkdown text={source.text} />
					</div>
				) : (
					<FileFrame
						key={fileTitle(source)}
						source={source}
						onOpenFile={onOpenFile}
						onFullscreen={onFullscreen}
					/>
				)}
				{inFrame ? <FrameReturn onReturn={onReturn} /> : null}
			</div>
		</fieldset>
	);
}
