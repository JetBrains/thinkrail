import { useT } from "@thinkrail/locales/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { frameMessage, themeMessage } from "./frameMessages";
import { HtmlFrame } from "./HtmlFrame";
import { hostThemeSnapshot, serverThemeSnapshot, subscribeHostTheme } from "./hostTheme";
import { buildScriptedHtmlDocument } from "./htmlDocument";
import type { HtmlViewport } from "./viewport";

const READY_GRACE_MS = 2000;

export function ScriptedHtmlFrame({
	title,
	source,
	viewport,
	contentHeight,
	onContentHeight,
}: {
	title: string;
	source: string;
	viewport: HtmlViewport;
	contentHeight?: number | null;
	onContentHeight?: (height: number) => void;
}) {
	const theme = useSyncExternalStore(subscribeHostTheme, hostThemeSnapshot, serverThemeSnapshot);
	const [built, setBuilt] = useState(() => ({
		source,
		...buildScriptedHtmlDocument(source, theme),
	}));
	let current = built;
	if (built.source !== source) {
		current = { source, ...buildScriptedHtmlDocument(source, theme) };
		setBuilt(current);
	}
	const { html, nonce } = current;
	const t = useT();
	const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
	const [loadedNonce, setLoadedNonce] = useState<string | null>(null);
	const [readyNonce, setReadyNonce] = useState<string | null>(null);
	const [blockedNonce, setBlockedNonce] = useState<string | null>(null);
	const blocked = blockedNonce === nonce;
	const onLoad = () => {
		if (loadedNonce === nonce) {
			setBlockedNonce(nonce);
			return;
		}
		setLoadedNonce(nonce);
		frame?.contentWindow?.postMessage(themeMessage(theme), "*");
	};

	useEffect(() => {
		frame?.contentWindow?.postMessage(themeMessage(theme), "*");
	}, [frame, theme]);

	useEffect(() => {
		if (loadedNonce !== nonce || readyNonce === nonce) return;
		const timer = setTimeout(() => setBlockedNonce(nonce), READY_GRACE_MS);
		return () => clearTimeout(timer);
	}, [loadedNonce, readyNonce, nonce]);

	useEffect(() => {
		if (!frame || blocked) return;
		const onMessage = (event: MessageEvent) => {
			if (event.source !== frame.contentWindow) return;
			const message = frameMessage(event.data, nonce);
			if (message?.kind === "ready") setReadyNonce(nonce);
			else if (message?.kind === "leave") setBlockedNonce(nonce);
			else if (message?.kind === "height") onContentHeight?.(message.height);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [frame, nonce, onContentHeight, blocked]);

	if (blocked) {
		return (
			<p
				role="status"
				data-testid="html-navigation-blocked"
				className="m-0 px-12 py-16 tr-text-metadata text-feedback-warning"
			>
				{t("viewer.html.navigationBlocked")}
			</p>
		);
	}

	return (
		<HtmlFrame
			title={title}
			document={html}
			viewport={viewport}
			sandbox="allow-scripts"
			frameRef={setFrame}
			onLoad={onLoad}
			{...(contentHeight === undefined ? {} : { contentHeight })}
		/>
	);
}
