import {
	RiCodeSSlashLine as Code,
	RiComputerLine as Desktop,
	RiFullscreenLine as Maximize,
	RiSmartphoneLine as Phone,
	RiTabletLine as Tablet,
} from "@remixicon/react";
import type { AssetResolver } from "@thinkrail/extension-api/web";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { HtmlFrame } from "@thinkrail/ui/html-frame";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
	buildMockupDocumentWithAssets,
	clampMockupHeight,
	MOCKUP_VIEWPORTS,
	type MockupDocumentView,
	type MockupViewport,
	mockupScale,
	VIEWPORT_WIDTHS,
} from "./mockup";

const SIDE_BY_SIDE_MIN_WIDTH = 1024;
const INITIAL_HEIGHT = 360;

const VIEWPORT_META: Record<MockupViewport, { label: string; Icon: typeof Desktop }> = {
	desktop: { label: "Desktop width", Icon: Desktop },
	tablet: { label: "Tablet width", Icon: Tablet },
	phone: { label: "Phone width", Icon: Phone },
};

const toolButton =
	"rounded-sm p-4 text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary aria-pressed:bg-control-bg-hovered aria-pressed:text-text-default";

function useElementWidth<T extends HTMLElement>(): [(element: T | null) => void, number] {
	const [element, setElement] = useState<T | null>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setWidth(entry.contentRect.width);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);
	return [setElement, width];
}

function useMockupDocument(html: string, resolveAsset: AssetResolver | undefined): string | null {
	const [built, setBuilt] = useState<{ html: string; document: string } | null>(null);
	useEffect(() => {
		let cancelled = false;
		buildMockupDocumentWithAssets(html, resolveAsset).then((document) => {
			if (!cancelled) setBuilt({ html, document });
		});
		return () => {
			cancelled = true;
		};
	}, [html, resolveAsset]);
	return built?.html === html ? built.document : null;
}

function ScaledMockupFrame({
	html,
	title,
	viewport,
	resolveAsset,
	capHeight,
}: {
	html: string;
	title: string;
	viewport: MockupViewport;
	resolveAsset: AssetResolver | undefined;
	capHeight: boolean;
}) {
	const document = useMockupDocument(html, resolveAsset);
	const [box, containerWidth] = useElementWidth<HTMLDivElement>();
	const [contentHeight, setContentHeight] = useState<number | null>(null);
	const frameWidth = VIEWPORT_WIDTHS[viewport];
	const scale = mockupScale(containerWidth, frameWidth);
	const height = clampMockupHeight(contentHeight ?? INITIAL_HEIGHT);
	const geometry = {
		"--mockup-width": `${frameWidth}px`,
		"--mockup-height": `${height}px`,
		"--mockup-scale": String(scale),
		"--mockup-box-height": `${Math.ceil(height * scale)}px`,
	} as CSSProperties;

	return (
		<div
			ref={box}
			data-testid="mockup-frame-box"
			data-viewport={viewport}
			className={cn(
				"w-full overflow-y-auto rounded-sm border border-border-default bg-container-workspace-bg",
				capHeight && "max-h-[640px]",
			)}
		>
			<div
				className="relative h-[var(--mockup-box-height)] w-full overflow-hidden"
				style={geometry}
			>
				{document === null ? (
					<span className="absolute inset-0 flex items-center justify-center text-text-muted tr-text-metadata">
						Rendering mockup…
					</span>
				) : (
					<HtmlFrame
						title={title}
						document={document}
						onContentSize={(size) => setContentHeight(size.height)}
						className="-translate-x-1/2 absolute top-0 left-1/2 h-[var(--mockup-height)] w-[var(--mockup-width)] max-w-none origin-top scale-[var(--mockup-scale)] border-0 bg-container-workspace-bg"
					/>
				)}
			</div>
		</div>
	);
}

function Segmented<T extends string>({
	label,
	items,
	value,
	onChange,
	testId,
}: {
	label: string;
	items: readonly { value: T; content: ReactNode; tooltip?: string }[];
	value: T;
	onChange: (value: T) => void;
	testId: string;
}) {
	return (
		<fieldset
			aria-label={label}
			data-testid={testId}
			className="m-0 flex min-w-0 items-center gap-2 border-0 p-0"
		>
			{items.map((item) => {
				const button = (
					<button
						key={item.value}
						type="button"
						aria-pressed={item.value === value}
						aria-label={item.tooltip}
						data-value={item.value}
						onClick={() => onChange(item.value)}
						className={cn(toolButton, !item.tooltip && "px-8 tr-text-metadata")}
					>
						{item.content}
					</button>
				);
				return item.tooltip ? (
					<IconTooltip key={item.value} label={item.tooltip}>
						{button}
					</IconTooltip>
				) : (
					button
				);
			})}
		</fieldset>
	);
}

export interface MockupViewProps {
	documents: readonly MockupDocumentView[];
	title?: string | undefined;
	viewport?: MockupViewport | undefined;
	resolveAsset?: AssetResolver | undefined;
}

export function MockupView({
	documents,
	title,
	viewport: initialViewport,
	resolveAsset,
}: MockupViewProps) {
	const [viewport, setViewport] = useState<MockupViewport>(initialViewport ?? "desktop");
	const [selected, setSelected] = useState(String(documents.length - 1));
	const [showSource, setShowSource] = useState(false);
	const [open, setOpen] = useState(false);
	const [dialogBody, dialogWidth] = useElementWidth<HTMLDivElement>();
	const index = Math.min(Number(selected), documents.length - 1);
	const current = documents[index];
	if (!current) return null;
	const heading = title || current.label;
	const paired = documents.length > 1;
	const sideBySide = paired && dialogWidth >= SIDE_BY_SIDE_MIN_WIDTH;

	const switcher = paired ? (
		<Segmented
			label="Version"
			testId="mockup-version"
			value={String(index)}
			onChange={setSelected}
			items={documents.map((document, i) => ({ value: String(i), content: document.label }))}
		/>
	) : null;
	const viewportSwitch = (
		<Segmented
			label="Viewport"
			testId="mockup-viewport"
			value={viewport}
			onChange={setViewport}
			items={MOCKUP_VIEWPORTS.map((value) => {
				const { label, Icon } = VIEWPORT_META[value];
				return { value, tooltip: label, content: <Icon className="size-14" /> };
			})}
		/>
	);

	return (
		<div
			data-testid="mockup-view"
			data-paired={paired || undefined}
			className="flex min-w-0 flex-col gap-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-8">{switcher}</div>
				<div className="flex items-center gap-4">
					{viewportSwitch}
					<IconTooltip label={showSource ? "Show mockup" : "Show HTML source"}>
						<button
							type="button"
							data-testid="mockup-source-toggle"
							aria-label="Show HTML source"
							aria-pressed={showSource}
							onClick={() => setShowSource((value) => !value)}
							className={toolButton}
						>
							<Code className="size-14" />
						</button>
					</IconTooltip>
					<IconTooltip label="Full screen">
						<button
							type="button"
							data-testid="mockup-fullscreen"
							aria-label="View mockup full screen"
							onClick={() => setOpen(true)}
							className={toolButton}
						>
							<Maximize className="size-14" />
						</button>
					</IconTooltip>
				</div>
			</div>
			{showSource ? (
				<pre
					data-testid="mockup-source"
					className="max-h-[640px] overflow-auto whitespace-pre-wrap break-all rounded-sm bg-container-header-bg p-8 tr-code-text text-text-default"
				>
					{current.html}
				</pre>
			) : (
				<ScaledMockupFrame
					key={`${index}-${viewport}`}
					html={current.html}
					title={`Mockup: ${heading}${paired ? ` (${current.label})` : ""}`}
					viewport={viewport}
					resolveAsset={resolveAsset}
					capHeight
				/>
			)}
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent
					data-testid="mockup-fullscreen-dialog"
					className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-8"
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>{heading}</DialogTitle>
					</DialogHeader>
					<div className="flex flex-wrap items-center justify-between gap-4">
						<div>{sideBySide ? null : switcher}</div>
						{viewportSwitch}
					</div>
					<div
						ref={dialogBody}
						data-testid="mockup-fullscreen-body"
						data-layout={sideBySide ? "side-by-side" : "single"}
						className={cn("min-h-0 flex-1 overflow-auto", sideBySide && "grid grid-cols-2 gap-8")}
					>
						{(sideBySide ? documents : [current]).map((document) => (
							<div key={document.label} className="flex min-w-0 flex-col gap-4">
								{sideBySide ? (
									<span className="tr-text-ui text-text-muted">{document.label}</span>
								) : null}
								<ScaledMockupFrame
									key={viewport}
									html={document.html}
									title={`Mockup: ${heading} (${document.label})`}
									viewport={viewport}
									resolveAsset={resolveAsset}
									capHeight={false}
								/>
							</div>
						))}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
