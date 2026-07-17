import { WS_CHANNELS } from "@thinkrail/contracts";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { type ITheme, Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { cssColorToHex } from "@/lib";
import { getTransport } from "../transport";

function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

/** A color token, canonicalized to hex — minified CSS can serve any equivalent form (`#fff`, `gray`),
 * and xterm's parser takes hex/rgb only. Unparseable reads as unset → xterm's default for that slot. */
function cssColorVar(name: string): string | undefined {
	return cssColorToHex(cssVar(name) ?? "") || undefined;
}

/** The 16 ANSI slots, each fed by its `--ansi-*` token — so shell colors stay legible per theme (the
 * light theme swaps in a light-tuned palette; xterm's dark-tuned defaults wash out on white). */
const ANSI_TOKENS = [
	["black", "--ansi-black"],
	["red", "--ansi-red"],
	["green", "--ansi-green"],
	["yellow", "--ansi-yellow"],
	["blue", "--ansi-blue"],
	["magenta", "--ansi-magenta"],
	["cyan", "--ansi-cyan"],
	["white", "--ansi-white"],
	["brightBlack", "--ansi-bright-black"],
	["brightRed", "--ansi-bright-red"],
	["brightGreen", "--ansi-bright-green"],
	["brightYellow", "--ansi-bright-yellow"],
	["brightBlue", "--ansi-bright-blue"],
	["brightMagenta", "--ansi-bright-magenta"],
	["brightCyan", "--ansi-bright-cyan"],
	["brightWhite", "--ansi-bright-white"],
] as const;

/** xterm theme from the live CSS tokens (no raw hex; falls back to xterm defaults if a token is unset). */
function readTheme(): ITheme {
	const theme: ITheme = {};
	const bg = cssColorVar("--surface-content");
	if (bg) theme.background = bg;
	const fg = cssColorVar("--text");
	if (fg) theme.foreground = fg;
	const cursor = cssColorVar("--primary");
	if (cursor) theme.cursor = cursor;
	const sel = cssColorVar("--sel");
	if (sel) theme.selectionBackground = sel;
	for (const [slot, name] of ANSI_TOKENS) {
		const color = cssColorVar(name);
		if (color) theme[slot] = color;
	}
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
	const serverIdRef = useRef<string | null>(null);
	const fitFnRef = useRef<(() => void) | null>(null);
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
		term.open(host);

		// Fit + push the new size to the PTY — but only when the host actually has a size. A hidden layer
		// (display:none) reports 0×0, and fitting against that resizes xterm to a bogus 1-row viewport,
		// spilling the scrollback out of view (it looks like the buffer was cleared on the next re-show).
		// Skipping the zero-size case keeps the buffer intact across workspace/tab switches; the
		// ResizeObserver re-fits for real once the layer is shown and laid out.
		const applyFit = (): void => {
			if (host.clientWidth === 0 || host.clientHeight === 0) return;
			tryLoad(() => fit.fit());
			const id = serverIdRef.current;
			if (id)
				void getTransport().request("terminal.resize", { id, cols: term.cols, rows: term.rows });
		};
		fitFnRef.current = applyFit;
		requestAnimationFrame(applyFit);

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

		const resizeObserver = new ResizeObserver(applyFit);
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

	// Hidden containers report zero size, so fit + focus when this layer becomes visible. `applyFit`
	// no-ops until the layer has a real size, so a not-yet-laid-out frame can't shrink the buffer; the
	// ResizeObserver fires the effective fit once layout settles.
	useEffect(() => {
		if (!visible) return;
		const frame = requestAnimationFrame(() => {
			fitFnRef.current?.();
			// Snap the viewport back to the live prompt: a resize while hidden can leave it scrolled off the
			// buffer, so on re-show the rendered rows would otherwise show blank/stale rows instead of the
			// preserved output.
			termRef.current?.scrollToBottom();
			termRef.current?.focus();
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
