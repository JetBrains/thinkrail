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
import { cssColorToHex } from "@/lib";
import { useAppStore } from "../store";
import { onThemeSwap } from "../themes";
import { getTransport } from "../transport";
import { createPtySizeSync, runAfterTerminalRelayout } from "./ptySizeSync";
import { createTerminalPrebindBuffer } from "./terminalPrebindBuffer";

/**
 * Trailing-edge delay before an observed resize reaches the PTY. Long enough that a divider drag collapses into
 * one `ioctl`+SIGWINCH instead of one per layout frame, short enough to feel immediate on release.
 */
const RESIZE_DEBOUNCE_MS = 60;

/**
 * Deadline on the pre-attach web-font relayout: `relayout()` stays *pending* (not rejected) while a font
 * request stalls, so an unbounded wait would leave the pane blank with no shell. Generous enough for a cold
 * cache over a slow remote link; see the panels SPEC for the fallback semantics.
 */
const RELAYOUT_TIMEOUT_MS = 4000;

/**
 * Fire-and-forget terminal writes. Reconnect replay + host request deduplication still executes a submitted
 * write at most once; callers merely have no useful UI to show for a true host rejection.
 */
function sendTerminalWrite(send: Promise<unknown>): void {
	void send.catch(() => {});
}

/** The `keyCode` browsers report while an input method owns a keystroke, instead of the real key's code. */
const IME_SENTINEL_KEYCODE = 229;

/**
 * The bytes xterm *would* have sent for a control chord, derived from the physical key.
 *
 * Works around xterm 6.0.0 dropping `Ctrl+<letter>` and `Escape` outright while a CJK input method is active
 * (upstream #6065). Its chord table switches on `keyCode`, and every Ctrl branch needs 65–90 / 32 / 51–55 / 56
 * / 219–221 — but an active IME reports 229 for everything, so nothing matches and *no key is emitted at all*.
 * The practical cost is that a Chinese, Japanese or Korean user cannot interrupt a runaway process.
 *
 * `event.code` stays accurate under an IME, so the physical key is still recoverable. Returns null for anything
 * that isn't a chord we're rescuing, leaving normal text input entirely alone.
 */
function imeControlBytes(event: KeyboardEvent): string | null {
	if (event.altKey || event.metaKey) return null;
	// Escape is dropped by the same table gap, and it's how you leave vim.
	if (event.code === "Escape") return "\x1b";
	if (!event.ctrlKey) return null;
	const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
	// Ctrl+A → 0x01 … Ctrl+Z → 0x1a, exactly what xterm computes from a non-IME keyCode.
	return letter ? String.fromCharCode(letter.charCodeAt(0) - 64) : null;
}

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
	const bg = cssColorVar("--container-terminal-bg");
	if (bg) theme.background = bg;
	const fg = cssColorVar("--text-default");
	if (fg) theme.foreground = fg;
	const cursor = cssColorVar("--primary");
	if (cursor) theme.cursor = cursor;
	const sel = cssColorVar("--editor-selection-bg");
	if (sel) theme.selectionBackground = sel;
	// Optional selected-text color (high-contrast: black on the yellow selection); unset → xterm default.
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
	} catch {
		// An optional addon failing to load must not break the terminal.
	}
}

interface Props {
	/** This tab's durable identity. Half of `(workspaceId, tabKey)`, which is what the host keys shells on. */
	tabKey: string;
	workspaceId: string;
	/**
	 * Run once, on the shell this tab was opened for (e.g. "Open in Vim"), then spent.
	 *
	 * The mount effect runs many times per tab — every trip to Project Home unmounts it — so it is gated on the
	 * host's `created` flag *and* cleared from the store once used. `created` alone is not enough: a tab whose
	 * shell exited gets a fresh one on the next attach, which is also `created`.
	 */
	initialCommand?: string;
}

/**
 * One xterm terminal bound to a server PTY.
 *
 * The shell belongs to `(workspaceId, tabKey)`, not to this component — so unmounting does **nothing** to it.
 * No detach registry, no liveness probe, no "was my tab closed or did the panel go away?" inference: mounting
 * is a single idempotent `terminal.attach`, and the only thing that kills a shell is the user closing the tab.
 * Attach returns the recorded output to repaint, so a remount shows the screen it left behind rather than an
 * empty buffer over a live process.
 */
export default function TerminalInstance({ tabKey, workspaceId, initialCommand }: Props) {
	const hostRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const serverIdRef = useRef<string | null>(null);
	const fitFnRef = useRef<(() => void) | null>(null);
	/** Re-run the attach — how the "take it back" action reclaims a tab another client took over. */
	const reattachRef = useRef<(() => void) | null>(null);
	/** Immutable tab creation intent; prop changes must not tear down a live shell. */
	const initialCommandRef = useRef(initialCommand);
	const [ready, setReady] = useState(false);
	/** The shell behind this tab is gone — see the `terminal.exit` subscription below. */
	const [exited, setExited] = useState(false);
	/** No PTY could be obtained, so this pane is inert — see the attach rejection below. */
	const [failed, setFailed] = useState(false);
	/** Another client attached to this tab, so its output goes there now — see `terminal.detached`. */
	const [detached, setDetached] = useState(false);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const term = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			// Font family + size are the primitives behind `code.text` (typography.json → textStyles.code):
			// both come from the same tokens the CSS emits, so the terminal can never drift from code text.
			// Row height stays xterm's own `lineHeight` mechanism (default 1.0) — the semantic token owns the
			// font, xterm owns line spacing, so we deliberately do not feed it a CSS line-height.
			fontSize: Number.parseFloat(cssVar("--tr-font-size-s13") ?? "") || 13,
			fontFamily: cssVar("--tr-font-family-code") ?? "monospace",
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
		// `false` = don't relayout on activation; we drive it below so we know when to re-fit.
		const webFonts = new WebFontsAddon(false);
		tryLoad(() => term.loadAddon(webFonts));
		termRef.current = term;
		term.open(host);

		// Rescue the control chords an active input method makes xterm drop (see `imeControlBytes`). Returning
		// false claims the event so xterm doesn't also act on it; returning true for everything else keeps the
		// library's own handling — including ordinary composition, which is deliberately untouched.
		term.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown" || event.keyCode !== IME_SENTINEL_KEYCODE) return true;
			// Mid-composition the keystroke belongs to the IME: Escape cancels the candidate, letters build it.
			if (event.isComposing) return true;
			const bytes = imeControlBytes(event);
			if (bytes === null) return true;
			const id = serverIdRef.current;
			if (id) sendTerminalWrite(getTransport().request("terminal.write", { id, data: bytes }));
			return false;
		});

		// Fit + push the new size to the PTY — but only when the host actually has a size. A hidden layer
		// (display:none) reports 0×0, and fitting against that resizes xterm to a bogus 1-row viewport,
		// spilling the scrollback out of view (it looks like the buffer was cleared on the next re-show).
		// Skipping the zero-size case keeps the buffer intact across workspace/tab switches; the
		// ResizeObserver re-fits for real once the layer is shown and laid out.
		const sizeSync = createPtySizeSync(({ cols, rows }) => {
			const id = serverIdRef.current;
			if (!id) return Promise.reject(new Error("terminal is no longer live"));
			return getTransport().request("terminal.resize", { id, cols, rows });
		});
		const applyFit = (): void => {
			if (host.clientWidth === 0 || host.clientHeight === 0) return;
			tryLoad(() => fit.fit());
			if (!serverIdRef.current) return;
			// A PTY resize is an ioctl plus a SIGWINCH to the shell, and full-screen apps (vim, htop, lazygit)
			// repaint on every one. The synchronizer sends only genuine changes, serializes them, and advances
			// its acknowledged grid only after the host confirms the request.
			sizeSync.request({ cols: term.cols, rows: term.rows });
		};

		// Trailing-edge debounce for observed layout changes. Dragging the terminals divider fires the
		// ResizeObserver on *every* layout frame; without this the shell got dozens of SIGWINCHes a second and a
		// full-screen app visibly thrashed. Direct callers (the initial fit, becoming visible) still go straight
		// through — they are single events, not a stream.
		let fitTimer: ReturnType<typeof setTimeout> | undefined;
		const scheduleFit = (): void => {
			clearTimeout(fitTimer);
			fitTimer = setTimeout(applyFit, RESIZE_DEBOUNCE_MS);
		};

		fitFnRef.current = applyFit;
		// Fit once synchronously so `term.cols/rows` are the real grid by the time we ask for a PTY — a shell
		// born at the wrong size prints its first prompt for the wrong width and then reflows. No-ops (leaving
		// xterm's 80×24 default) if this layer isn't laid out yet, which the rAF below then corrects.
		applyFit();
		requestAnimationFrame(applyFit);

		// Pushes can beat the attach response, before this instance knows which PTY is its own. The bounded
		// pre-bind buffer filters on adoption and becomes inert on bind/failure.
		// One buffer PER ATTACH ATTEMPT, not per mount. A buffer is single-use — inert once bound — so reusing it
		// for a reclaim ("Take it back") would leave the reclaimed attempt unable to correlate anything that
		// arrives before its response, while `detached` has already cleared the id. A reconnect makes that
		// concrete: the host resumes a held `terminal.exit` on `open`, before it re-serves the replayed attach
		// from its cache, so the exit would be dropped by both the inert buffer and the null id — and the pane
		// would then go ready over a shell that is already dead.
		let prebind = createTerminalPrebindBuffer();
		const writeTruncation = (): void => term.write("\r\n[output truncated]\r\n");
		/** Paint a batch, saying so when the host had to drop output to stay bounded. */
		const writeFrame = (ev: TerminalDataPush): void => {
			// The host cannot slow a shell down (`bun-pty` exposes no pause), so a flood that outran a reconnect
			// loses its oldest output rather than growing until the host dies. Silently dropping it would look
			// like the shell simply printed less than it did.
			if (ev.truncated) writeTruncation();
			term.write(ev.data);
		};
		const unsubscribe = getTransport().subscribe(WS_CHANNELS.terminalData, (payload) => {
			const ev = payload as TerminalDataPush;
			if (prebind.acceptData(ev)) return;
			if (ev.id === serverIdRef.current) writeFrame(ev);
		});
		const onData = term.onData((data) => {
			// A null id is also how a taken-over tab stops accepting input: typing into it would run commands
			// whose output goes to whoever attached last.
			const id = serverIdRef.current;
			if (id) sendTerminalWrite(getTransport().request("terminal.write", { id, data }));
		});

		// The shell exited (the user typed `exit`, or it crashed). Until the host said so, the tab went on
		// looking alive — cursor blinking, keystrokes accepted — while every keystroke was written to a dead id
		// and silently dropped, with no way to tell.
		/**
		 * Bumped whenever this tab is taken over. An attach response is only proof of attachment *as of when the
		 * host handled it*: a takeover can land in between, and a reconnect even replays the original request and
		 * gets the cached success back. Comparing generations lets a later detach always win, so the pane can
		 * never go ready over a PTY that now rejects everything it sends.
		 */
		let attachGeneration = 0;

		const handleExit = (ev: TerminalExitPush): void => {
			if (ev.id !== serverIdRef.current) return;
			// Forget the id: there is nothing left to write to. The TAB stays — the user closes it themselves,
			// and attaching again would simply give this tab a fresh shell.
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
				// A PTY has one size, so only one client can have its layout honoured. Say so rather than going
				// quietly dead, and offer to take it back.
				serverIdRef.current = null;
				attachGeneration += 1;
				setReady(false);
				setDetached(true);
			},
		);

		let disposed = false;

		/**
		 * Ask the host for this tab's shell.
		 *
		 * Idempotent get-or-create, so there is exactly one call and no state to hold between steps. Unmounting
		 * mid-flight needs no cleanup at all: the shell belongs to the tab, and the next mount asks the same
		 * question and gets the same shell. That is the whole reason this replaced a client-held registry —
		 * the old path removed its only pointer before a liveness round trip, and a remount inside that window
		 * spawned a second shell and orphaned the first for the life of the host.
		 */
		const attach = (): void => {
			// The size the PTY is spawned at, captured NOW. Recording `term.cols` at resolve time instead would
			// bake in whatever the grid had since become, so a resize that landed while this request was in
			// flight would look already-applied and never be sent — leaving the shell permanently mis-sized.
			const spawnedAt = { cols: term.cols, rows: term.rows };
			const startedAt = attachGeneration;
			// Retire the previous attempt's buffer and take a fresh one for this attempt, so pushes that beat this
			// response are held for it. The subscriptions read `prebind` at call time, so they follow it.
			prebind.stop();
			const attemptPrebind = createTerminalPrebindBuffer();
			prebind = attemptPrebind;
			void getTransport()
				.request("terminal.attach", { workspaceId, tabKey, ...spawnedAt })
				.then(({ id, created, replay }) => {
					if (disposed) return;
					// Someone took the tab over while this was in flight, so this answer is already stale. A newer
					// attempt owns `prebind` by now; only this attempt's own buffer is ours to retire.
					if (attachGeneration !== startedAt || prebind !== attemptPrebind) {
						attemptPrebind.stop();
						return;
					}
					const finishAttach = (): void => {
						// Parsing the replay is asynchronous. A takeover or newer attempt can land while it is queued,
						// so adoption needs the same freshness check at the point the PTY becomes writable.
						if (disposed || attachGeneration !== startedAt || prebind !== attemptPrebind) {
							attemptPrebind.stop();
							return;
						}
						sizeSync.acknowledge(spawnedAt);
						serverIdRef.current = id;
						const buffered = attemptPrebind.bind(id);
						if (buffered.truncated) writeTruncation();
						for (const ev of buffered.frames) writeFrame(ev);
						// The host now knows this tab, so it is no longer exempt from an authoritative list.
						useAppStore.getState().settleTerminalAttach(workspaceId, tabKey);
						setDetached(false);
						setExited(false);
						setReady(true);
						// A very short-lived shell can send its addressed exit before the response names its id.
						// Paint buffered data first, then apply that matching exit exactly as a live subscription would.
						if (buffered.exit) handleExit(buffered.exit);
						// Catch up if the grid moved while we were waiting; a no-op when it didn't.
						applyFit();
						if (created && serverIdRef.current === id && initialCommandRef.current) {
							sendTerminalWrite(
								getTransport().request("terminal.write", {
									id,
									data: `${initialCommandRef.current}\r`,
								}),
							);
							// Spend it: `created` is also true when a tab's previous shell exited and this attach spawned
							// a replacement, so gating on that alone would reopen vim on every revisit.
							initialCommandRef.current = undefined;
							useAppStore.getState().consumeTerminalInitialCommand(workspaceId, tabKey);
						}
					};
					// Repaint before the PTY id becomes writable. Queries in historical output must not be answered
					// into the live shell; genuinely live frames stay in `attemptPrebind` until this parse completes.
					if (replay) term.write(replay, finishAttach);
					else finishAttach();
				})
				.catch(() => {
					if (disposed || attachGeneration !== startedAt || prebind !== attemptPrebind) {
						attemptPrebind.stop();
						return;
					}
					// Reconnects replay this request, so this is a real host refusal or deadline rather than an
					// ambiguous dropped response. Stop pre-bind intake: this failed pane must not retain every other
					// terminal's addressed output for the rest of its life.
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
				// dispose() nulls the addon's terminal, so the timed-out relayout's eventual settlement skips its
				// re-measuring fontFamily toggle instead of re-laying-out an already-attached terminal.
				onTimeout: () => webFonts.dispose(),
			},
		);

		const resizeObserver = new ResizeObserver(scheduleFit);
		resizeObserver.observe(host);

		const stopThemeWatch = onThemeSwap(() => {
			term.options.theme = readTheme();
		});

		return () => {
			// Nothing here touches the shell. It belongs to the tab and outlives every view of it — only
			// `terminal.close`, driven by the user closing the tab, ever kills one.
			disposed = true;
			reattachRef.current = null;
			prebind.stop();
			sizeSync.dispose();
			clearTimeout(fitTimer);
			resizeObserver.disconnect();
			stopThemeWatch();
			onData.dispose();
			unsubscribe();
			unsubscribeExit();
			unsubscribeDetached();
			serverIdRef.current = null;
			term.dispose();
		};
	}, [tabKey, workspaceId]);

	// This instance is mounted only while it is the tab on screen, so mounting IS becoming visible: fit against
	// the real layout once it exists, put the viewport on the live prompt, and take focus. `applyFit` no-ops
	// until the layer has a size, and the ResizeObserver fires the effective fit once layout settles.
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
			// Always true now that only the shown tab is mounted — kept so tests and tooling can address "the
			// terminal on screen" without knowing that.
			data-visible="true"
			className="absolute inset-0"
		>
			<div ref={hostRef} className="h-full w-full" />
			{detached ? (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-sm bg-overlay">
					<p className="tr-text-metadata text-text-muted">This terminal is open somewhere else.</p>
					<button
						type="button"
						data-testid="terminal-take-back"
						onClick={takeBack}
						className="rounded-[var(--radius-sm)] bg-control-bg px-sm py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
					>
						Take it back
					</button>
				</div>
			) : null}
		</div>
	);
}
