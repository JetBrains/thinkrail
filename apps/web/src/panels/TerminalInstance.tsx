import { WS_CHANNELS } from "@thinkrail/contracts";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { type ITheme, Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { getTransport } from "../transport";

function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

/** xterm theme from the live CSS tokens (no raw hex; falls back to xterm defaults if a token is unset). */
function readTheme(): ITheme {
	const theme: ITheme = {};
	const bg = cssVar("--surface-content");
	if (bg) theme.background = bg;
	const fg = cssVar("--text");
	if (fg) theme.foreground = fg;
	const cursor = cssVar("--primary");
	if (cursor) theme.cursor = cursor;
	const sel = cssVar("--sel");
	if (sel) theme.selectionBackground = sel;
	return theme;
}

function tryLoad(fn: () => void): void {
	try {
		fn();
	} catch {
		// An optional addon failing to load must not break the terminal.
	}
}

interface Props {
	clientId: string;
	workspaceId: string;
	visible: boolean;
}

/**
 * One xterm terminal bound to a server PTY. Stays mounted while its tab exists (hidden when not the
 * active tab) so its buffer survives workspace/tab switches; re-fits when it becomes visible.
 */
export default function TerminalInstance({ clientId, workspaceId, visible }: Props) {
	const hostRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const serverIdRef = useRef<string | null>(null);
	const [ready, setReady] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-once; clientId/workspaceId are stable per instance
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const term = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			fontSize: 12,
			fontFamily: cssVar("--font-mono") ?? "monospace",
			theme: readTheme(),
			scrollback: 5000,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		tryLoad(() => {
			term.loadAddon(new Unicode11Addon());
			term.unicode.activeVersion = "11";
		});
		tryLoad(() => term.loadAddon(new ClipboardAddon()));
		termRef.current = term;
		fitRef.current = fit;
		term.open(host);
		requestAnimationFrame(() => tryLoad(() => fit.fit()));

		// Buffer output that arrives before the PTY id is known (e.g. the initial shell prompt).
		const early: { id: string; data: string }[] = [];
		const unsubscribe = getTransport().subscribe(WS_CHANNELS.terminalData, (payload) => {
			const ev = payload as { id: string; data: string };
			const id = serverIdRef.current;
			if (id === null) {
				early.push(ev);
			} else if (ev.id === id) {
				term.write(ev.data);
			}
		});
		const onData = term.onData((data) => {
			const id = serverIdRef.current;
			if (id) void getTransport().request("terminal.write", { id, data });
		});

		let disposed = false;
		void getTransport()
			.request("terminal.create", { workspaceId })
			.then(({ id }) => {
				if (disposed) {
					void getTransport()
						.request("terminal.close", { id })
						.catch(() => {});
					return;
				}
				serverIdRef.current = id;
				for (const ev of early) if (ev.id === id) term.write(ev.data);
				early.length = 0;
				void getTransport().request("terminal.resize", { id, cols: term.cols, rows: term.rows });
				setReady(true);
			})
			.catch(() => {});

		const resizeObserver = new ResizeObserver(() => {
			tryLoad(() => fit.fit());
			const id = serverIdRef.current;
			if (id)
				void getTransport().request("terminal.resize", { id, cols: term.cols, rows: term.rows });
		});
		resizeObserver.observe(host);

		const themeObserver = new MutationObserver(() => {
			term.options.theme = readTheme();
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});

		return () => {
			disposed = true;
			resizeObserver.disconnect();
			themeObserver.disconnect();
			onData.dispose();
			unsubscribe();
			const id = serverIdRef.current;
			if (id)
				void getTransport()
					.request("terminal.close", { id })
					.catch(() => {});
			term.dispose();
		};
	}, [clientId, workspaceId]);

	// Hidden containers report zero size, so fit + focus when this layer becomes visible.
	useEffect(() => {
		if (!visible) return;
		const frame = requestAnimationFrame(() => {
			tryLoad(() => fitRef.current?.fit());
			const term = termRef.current;
			const id = serverIdRef.current;
			if (term && id) {
				void getTransport().request("terminal.resize", { id, cols: term.cols, rows: term.rows });
			}
			term?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [visible]);

	return (
		<div
			data-testid="terminal-instance"
			data-client-id={clientId}
			data-ready={ready}
			data-visible={visible}
			className={`absolute inset-0 ${visible ? "" : "hidden"}`}
		>
			<div ref={hostRef} className="h-full w-full" />
		</div>
	);
}
