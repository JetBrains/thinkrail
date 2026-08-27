import type {
	TerminalDataPush,
	TerminalDetachedPush,
	TerminalExitPush,
} from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { type ITheme, Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { type QuietScrollEdges, QuietScrollFrame } from "@/components/QuietScrollArea";
import { cssColorToHex } from "@/lib";
import { useAppStore } from "../store";
import { onThemeSwap } from "../themes";
import { getTransport } from "../transport";
import { createPtySizeSync, runAfterTerminalRelayout } from "./ptySizeSync";
import { stripAnsiDim, terminalContrastFloor } from "./terminalContrast";
import { createTerminalPrebindBuffer } from "./terminalPrebindBuffer";

const RESIZE_DEBOUNCE_MS = 60;

const RELAYOUT_TIMEOUT_MS = 4000;

function sendTerminalWrite(send: Promise<unknown>): void {
	void send.catch(() => {});
}

const IME_SENTINEL_KEYCODE = 229;

// xterm #6065: an active IME reports keyCode 229, so xterm's chord table drops Ctrl+<letter>/Escape — see panels/SPEC.md.
function imeControlBytes(event: KeyboardEvent): string | null {
	if (event.altKey || event.metaKey) return null;
	if (event.code === "Escape") return "\x1b";
	if (!event.ctrlKey) return null;
	const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
	return letter ? String.fromCharCode(letter.charCodeAt(0) - 64) : null;
}

function cssVar(name: string): string | undefined {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

function cssColorVar(name: string): string | undefined {
	return cssColorToHex(cssVar(name) ?? "") || undefined;
}

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

function isHighContrast(): boolean {
	return document.documentElement.dataset.themeContrast === "high";
}

function contrastFloor(): number {
	return terminalContrastFloor(isHighContrast());
}

function readTheme(): ITheme {
	const theme: ITheme = {};
	const bg = cssColorVar("--container-terminal-bg");
	if (bg) theme.background = bg;
	const fg = cssColorVar("--text-default");
	if (fg) theme.foreground = fg;
	const cursor = cssColorVar("--primary");
	if (cursor) theme.cursor = cursor;
	const sel = cssColorVar("--editor-selection-bg");
	if (sel) theme.selectionBackground = sel;
	const selFg = cssColorVar("--editor-selection-text");
	if (selFg) theme.selectionForeground = selFg;
	for (const [slot, name] of ANSI_TOKENS) {
		const color = cssColorVar(name);
		if (color) theme[slot] = color;
	}
	return theme;
}

function tryLoad(fn: () => void): void {
	try {
		fn();
	} catch {}
}

interface Props {
	tabKey: string;
	workspaceId: string;
	initialCommand?: string;
}

export default function TerminalInstance({ tabKey, workspaceId, initialCommand }: Props) {
	const hostRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const serverIdRef = useRef<string | null>(null);
	const fitFnRef = useRef<(() => void) | null>(null);
	const reattachRef = useRef<(() => void) | null>(null);
	const initialCommandRef = useRef(initialCommand);
	const [ready, setReady] = useState(false);
	const [exited, setExited] = useState(false);
	const [failed, setFailed] = useState(false);
	const [detached, setDetached] = useState(false);
	const [scrollEdges, setScrollEdges] = useState<QuietScrollEdges>({
		top: false,
		right: false,
		bottom: false,
		left: false,
	});

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const term = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			fontSize: Number.parseFloat(cssVar("--tr-font-size-s13") ?? "") || 13,
			fontFamily: cssVar("--tr-font-family-code") ?? "monospace",
			theme: readTheme(),
			minimumContrastRatio: contrastFloor(),
			scrollback: 5000,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		tryLoad(() => {
			term.loadAddon(new Unicode11Addon());
			term.unicode.activeVersion = "11";
		});
		tryLoad(() => term.loadAddon(new ClipboardAddon()));
		const webFonts = new WebFontsAddon(false);
		tryLoad(() => term.loadAddon(webFonts));
		termRef.current = term;
		term.open(host);
		const updateScrollEdges = () => {
			const buffer = term.buffer.active;
			const next = {
				top: buffer.viewportY > 0,
				right: false,
				bottom: buffer.viewportY < buffer.baseY,
				left: false,
			};
			setScrollEdges((current) =>
				current.top === next.top && current.bottom === next.bottom ? current : next,
			);
		};
		const onViewportScroll = term.onScroll(updateScrollEdges);
		const onBufferWrite = term.onWriteParsed(updateScrollEdges);
		const onTerminalResize = term.onResize(updateScrollEdges);
		updateScrollEdges();

		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown" || event.keyCode !== IME_SENTINEL_KEYCODE) return true;
			if (event.isComposing) return true;
			const bytes = imeControlBytes(event);
			if (bytes === null) return true;
			const id = serverIdRef.current;
			if (id) sendTerminalWrite(getTransport().request("terminal.write", { id, data: bytes }));
			return false;
		});

		const sizeSync = createPtySizeSync(({ cols, rows }) => {
			const id = serverIdRef.current;
			if (!id) return Promise.reject(new Error("terminal is no longer live"));
			return getTransport().request("terminal.resize", { id, cols, rows });
		});
		const applyFit = (): void => {
			if (host.clientWidth === 0 || host.clientHeight === 0) return;
			tryLoad(() => fit.fit());
			if (!serverIdRef.current) return;
			sizeSync.request({ cols: term.cols, rows: term.rows });
		};

		let fitTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleFit = (): void => {
			clearTimeout(fitTimer);
			fitTimer = setTimeout(applyFit, RESIZE_DEBOUNCE_MS);
		};

		fitFnRef.current = applyFit;
		applyFit();
		requestAnimationFrame(applyFit);

		let prebind = createTerminalPrebindBuffer();
		const writeOutput = (data: string, cb?: () => void): void =>
			term.write(isHighContrast() ? stripAnsiDim(data) : data, cb);
		const writeTruncation = (): void => term.write("\r\n[output truncated]\r\n");
		const writeFrame = (ev: TerminalDataPush): void => {
			if (ev.truncated) writeTruncation();
			writeOutput(ev.data);
		};
		const unsubscribe = getTransport().subscribe(WS_CHANNELS.terminalData, (payload) => {
			const ev = payload as TerminalDataPush;
			if (prebind.acceptData(ev)) return;
			if (ev.id === serverIdRef.current) writeFrame(ev);
		});
		const onData = term.onData((data) => {
			const id = serverIdRef.current;
			if (id) sendTerminalWrite(getTransport().request("terminal.write", { id, data }));
		});

		let attachGeneration = 0;

		const handleExit = (ev: TerminalExitPush): void => {
			if (ev.id !== serverIdRef.current) return;
			serverIdRef.current = null;
			term.write(`\r\n[process exited${ev.exitCode === 0 ? "" : ` with code ${ev.exitCode}`}]\r\n`);
			setExited(true);
		};
		const unsubscribeExit = getTransport().subscribe(WS_CHANNELS.terminalExit, (payload) => {
			const ev = payload as TerminalExitPush;
			if (prebind.acceptExit(ev)) return;
			handleExit(ev);
		});
		const unsubscribeDetached = getTransport().subscribe(
			WS_CHANNELS.terminalDetached,
			(payload) => {
				const ev = payload as TerminalDetachedPush;
				if (ev.workspaceId !== workspaceId || ev.tabKey !== tabKey) return;
				serverIdRef.current = null;
				attachGeneration += 1;
				setReady(false);
				setDetached(true);
			},
		);

		let disposed = false;

		const attach = (): void => {
			const spawnedAt = { cols: term.cols, rows: term.rows };
			const startedAt = attachGeneration;
			prebind.stop();
			const attemptPrebind = createTerminalPrebindBuffer();
			prebind = attemptPrebind;
			void getTransport()
				.request("terminal.attach", { workspaceId, tabKey, ...spawnedAt })
				.then(({ id, created, replay }) => {
					if (disposed) return;
					if (attachGeneration !== startedAt || prebind !== attemptPrebind) {
						attemptPrebind.stop();
						return;
					}
					const finishAttach = (): void => {
						if (disposed || attachGeneration !== startedAt || prebind !== attemptPrebind) {
							attemptPrebind.stop();
							return;
						}
						sizeSync.acknowledge(spawnedAt);
						serverIdRef.current = id;
						const buffered = attemptPrebind.bind(id);
						if (buffered.truncated) writeTruncation();
						for (const ev of buffered.frames) writeFrame(ev);
						setDetached(false);
						setExited(false);
						setReady(true);
						if (buffered.exit) handleExit(buffered.exit);
						applyFit();
						if (created && serverIdRef.current === id && initialCommandRef.current) {
							sendTerminalWrite(
								getTransport().request("terminal.write", {
									id,
									data: `${initialCommandRef.current}\r`,
								}),
							);
							initialCommandRef.current = undefined;
							useAppStore.getState().consumeTerminalInitialCommand(workspaceId, tabKey);
						}
					};
					if (replay) writeOutput(replay, finishAttach);
					else finishAttach();
				})
				.catch(() => {
					if (disposed || attachGeneration !== startedAt || prebind !== attemptPrebind) {
						attemptPrebind.stop();
						return;
					}
					attemptPrebind.stop();
					term.write("\r\n[could not start a shell — close this tab and open a new one]\r\n");
					setFailed(true);
				});
		};
		reattachRef.current = attach;
		void runAfterTerminalRelayout(
			() => webFonts.relayout(),
			() => {
				if (disposed) return;
				applyFit();
				attach();
			},
			{
				timeoutMs: RELAYOUT_TIMEOUT_MS,
				onTimeout: () => webFonts.dispose(),
			},
		);

		const resizeObserver = new ResizeObserver(scheduleFit);
		resizeObserver.observe(host);

		const stopThemeWatch = onThemeSwap(() => {
			term.options.theme = readTheme();
			term.options.minimumContrastRatio = contrastFloor();
		});

		return () => {
			disposed = true;
			reattachRef.current = null;
			prebind.stop();
			sizeSync.dispose();
			clearTimeout(fitTimer);
			resizeObserver.disconnect();
			stopThemeWatch();
			onData.dispose();
			onViewportScroll.dispose();
			onBufferWrite.dispose();
			onTerminalResize.dispose();
			unsubscribe();
			unsubscribeExit();
			unsubscribeDetached();
			serverIdRef.current = null;
			term.dispose();
		};
	}, [tabKey, workspaceId]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			fitFnRef.current?.();
			termRef.current?.scrollToBottom();
			termRef.current?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, []);

	const takeBack = useCallback(() => reattachRef.current?.(), []);

	return (
		<div
			data-testid="terminal-instance"
			data-tab-key={tabKey}
			data-ready={ready}
			data-exited={exited}
			data-failed={failed}
			data-detached={detached}
			data-visible="true"
			className="absolute inset-0 z-0"
		>
			<QuietScrollFrame
				viewportSelector=".xterm-scrollable-element"
				surface="terminal"
				edges={scrollEdges}
				className="absolute inset-12"
			>
				<div ref={hostRef} className="absolute inset-0" />
			</QuietScrollFrame>
			{detached ? (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-overlay">
					<p className="tr-text-metadata text-text-muted">This terminal is open somewhere else.</p>
					<button
						type="button"
						data-testid="terminal-take-back"
						onClick={takeBack}
						className="rounded-[var(--radius-sm)] bg-control-bg px-8 py-4 tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						Take it back
					</button>
				</div>
			) : null}
		</div>
	);
}
