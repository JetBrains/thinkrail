import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import {
	type CSSProperties,
	type SyntheticEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useElementSize } from "../../support/useElementSize";
import { HTML_INTERACTIVE_CSP } from "./htmlDocument";
import {
	frameLifecycleMessage,
	messageScrollEndpoint,
	type ScrollLink,
	windowScrollEndpoint,
} from "./scrollLink";
import { type HtmlViewport, htmlFrameGeometry } from "./viewport";

const NO_BOX = { width: 0, height: 0 };

const INTERACTIVE_FRAME = { sandbox: "allow-scripts", csp: HTML_INTERACTIVE_CSP };

function useLinkAttachment(scrollLink: ScrollLink | undefined, interactive: boolean) {
	const detachRef = useRef<(() => void) | null>(null);
	useEffect(
		() => () => {
			detachRef.current?.();
			detachRef.current = null;
		},
		[],
	);
	return (frame: HTMLIFrameElement) => {
		detachRef.current?.();
		detachRef.current = null;
		const view = frame.contentWindow;
		if (!scrollLink || !view) return;
		detachRef.current = scrollLink.attach(
			interactive ? messageScrollEndpoint(view) : windowScrollEndpoint(view),
		);
	};
}

const LOADED_GRACE_MS = 1000;

function InteractiveIframe({
	title,
	document,
	token,
	className,
	scrollLink,
	onLeft,
}: {
	title: string;
	document: string;
	token: string;
	className: string;
	scrollLink: ScrollLink | undefined;
	onLeft: () => void;
}) {
	const loads = useRef(0);
	const loaded = useRef(false);
	const grace = useRef<ReturnType<typeof setTimeout> | null>(null);
	const frameRef = useRef<HTMLIFrameElement>(null);
	const attach = useLinkAttachment(scrollLink, true);
	useLayoutEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const view = frameRef.current?.contentWindow;
			if (!view || event.source !== view) return;
			const lifecycle = frameLifecycleMessage(event.data, token);
			if (lifecycle === "left") onLeft();
			else if (lifecycle === "loaded") loaded.current = true;
		};
		window.addEventListener("message", onMessage);
		return () => {
			window.removeEventListener("message", onMessage);
			if (grace.current) clearTimeout(grace.current);
		};
	}, [onLeft, token]);
	const onLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
		loads.current += 1;
		if (loads.current > 1) {
			onLeft();
			return;
		}
		attach(event.currentTarget);
		grace.current = setTimeout(() => {
			if (!loaded.current) onLeft();
		}, LOADED_GRACE_MS);
	};
	return (
		<iframe
			ref={frameRef}
			title={title}
			{...INTERACTIVE_FRAME}
			srcDoc={document}
			onLoad={onLoad}
			data-interactive=""
			className={className}
		/>
	);
}

function StaticIframe({
	title,
	document,
	className,
	scrollLink,
}: {
	title: string;
	document: string;
	className: string;
	scrollLink: ScrollLink | undefined;
}) {
	const attach = useLinkAttachment(scrollLink, false);
	return (
		<iframe
			title={title}
			sandbox={scrollLink ? "allow-same-origin" : ""}
			srcDoc={document}
			onLoad={scrollLink ? (event) => attach(event.currentTarget) : undefined}
			className={className}
		/>
	);
}

function LeftPageNotice({ onReload }: { onReload: () => void }) {
	const t = useT();
	return (
		<div
			data-testid="html-left-page"
			role="status"
			className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-container-workspace-bg px-12 text-center tr-text-ui text-text-muted"
		>
			{t("viewer.html.leftPage")}
			<Button
				variant="outline"
				size="s"
				tabIndex={0}
				data-testid="html-left-page-reload"
				onClick={onReload}
			>
				{t("viewer.html.reload")}
			</Button>
		</div>
	);
}

export function HtmlFrame({
	title,
	document,
	viewport = "responsive",
	scrollLink,
	compact = false,
	interactiveToken,
}: {
	title: string;
	document: string;
	viewport?: HtmlViewport;
	scrollLink?: ScrollLink | undefined;
	compact?: boolean;
	interactiveToken?: string | undefined;
}) {
	const { ref: boxRef, size } = useElementSize<HTMLDivElement>();
	const [run, setRun] = useState({ document, generation: 0, left: false });
	if (run.document !== document) setRun({ document, generation: run.generation + 1, left: false });
	const box = size ?? NO_BOX;
	const geometry = htmlFrameGeometry(viewport, box);
	const fitted = viewport !== "responsive" && box.width > 0;
	const vars = {
		"--html-frame-width": `${geometry.width}px`,
		"--html-frame-height": `${geometry.height}px`,
		"--html-frame-scale": String(geometry.scale),
	} as CSSProperties;
	const frameClass = fitted
		? "absolute top-0 left-0 h-[var(--html-frame-height)] w-[var(--html-frame-width)] max-w-none origin-top-left scale-[var(--html-frame-scale)] border-0 bg-container-workspace-bg"
		: "absolute inset-0 h-full w-full border-0 bg-container-workspace-bg";

	return (
		<div
			ref={boxRef}
			data-testid="html-frame-box"
			data-viewport={viewport}
			data-scale={geometry.scale.toFixed(3)}
			className={cn(
				"relative h-full w-full overflow-hidden",
				compact ? "min-h-0" : "min-h-[360px]",
			)}
			style={fitted ? vars : undefined}
		>
			{interactiveToken === undefined ? (
				<StaticIframe
					title={title}
					document={document}
					className={frameClass}
					scrollLink={scrollLink}
				/>
			) : run.left ? (
				<LeftPageNotice
					onReload={() => setRun({ ...run, generation: run.generation + 1, left: false })}
				/>
			) : (
				<InteractiveIframe
					key={run.generation}
					title={title}
					document={document}
					token={interactiveToken}
					className={frameClass}
					scrollLink={scrollLink}
					onLeft={() => setRun((current) => ({ ...current, left: true }))}
				/>
			)}
		</div>
	);
}
