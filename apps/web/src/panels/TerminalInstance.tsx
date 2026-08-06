import type { TerminalDataPush, TerminalExitPush } from "@thinkrail/contracts";
import { WS_CHANNELS } from "@thinkrail/contracts";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebFontsAddon } from "@xterm/addon-web-fonts";
import { type ITheme, Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { cssColorToHex } from "@/lib";
import { useAppStore } from "../store";
import { onThemeSwap } from "../themes";
import { getTransport } from "../transport";
import { createPtySizeSync } from "./ptySizeSync";
import { createTerminalPrebindBuffer } from "./terminalPrebindBuffer";

/**
 * PTY ids left behind by unmounted instances, keyed by tab `clientId`.
 *
 * An instance unmounts for two very different reasons. Its **tab was closed** — the PTY should die. Or **the
 * surface it lives on went away while the tab survived**: the shell only mounts `TerminalsPanel` while a
 * workspace is active (`shell/Shell.tsx`), so every visit to Project Home unmounts every terminal of every
 * workspace. Killing the PTY in that second case silently kills whatever was running in it — a dev server, a
 * watch build — with no warning and no visible cause.
 *
 * So unmount hands the id here instead, and the next mount re-adopts it — after one `terminal.alive` round trip
 * to confirm the shell is still there, because a shell that died while detached had no mounted instance to hear
 * its `terminal.exit`. Once bound, output resumes on its own: `terminal.data` is keyed by PTY id. Module scope
 * is the point — the registry has to outlive the component.
 *
 * The registry only ever holds *detached* PTYs: adopting removes the entry, and a genuinely closed tab is
 * reaped rather than registered. A PTY orphaned by a page reload is reaped host-side once that client has been
 * gone for the abandoned-client grace window (a reload arrives under a new client id, so the old one never
 * comes back).
 * One entry can go stale — a workspace removed *while* its terminals are detached has no mounted instance to
 * run the reap — but the host kills those PTYs itself on archive, and `clientId` is a fresh UUID per tab, so a
 * stale entry can never be adopted by a later tab. It costs a dangling string until reload, nothing more.
 */
const detachedPtyByClientId = new Map<string, string>();

/**
 * Trailing-edge delay before an observed resize reaches the PTY. Long enough that a divider drag collapses into
 * one `ioctl`+SIGWINCH instead of one per layout frame, short enough to feel immediate on release.
 */
const RESIZE_DEBOUNCE_MS = 60;

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
	clientId: string;
	workspaceId: string;
	visible: boolean;
	/** Sent once, right after this terminal's PTY is *created* (e.g. "Open in Vim") — never replayed. The
	 * mount effect can run more than once per tab (see `detachedPtyByClientId`), so this deliberately hangs
	 * off the create branch only: re-attaching to an existing shell must not re-run the command. */
	initialCommand?: string;
}

/**
 * One xterm terminal bound to a server PTY. Stays mounted while its tab exists (hidden when not the
 * active tab) so its buffer survives workspace/tab switches; re-fits when it becomes visible.
 *
 * The PTY outlives the component, not the other way round: an unmount that leaves the tab in place detaches
 * the shell into `detachedPtyByClientId` for the next mount to adopt, so nothing running in it dies. Only a
 * closed tab kills its PTY.
 */
export default function TerminalInstance({
	clientId,
	workspaceId,
	visible,
	initialCommand,
}: Props) {
	const hostRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const serverIdRef = useRef<string | null>(null);
	const fitFnRef = useRef<(() => void) | null>(null);
	/** Immutable tab creation intent; prop changes must not tear down a live shell. */
	const initialCommandRef = useRef(initialCommand);
	const [ready, setReady] = useState(false);
	/** The shell behind this tab is gone — see the `terminal.exit` subscription below. */
	const [exited, setExited] = useState(false);
	/** No PTY was ever obtained, so this pane is inert — see the `terminal.create` rejection below. */
	const [failed, setFailed] = useState(false);

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

		// Pushes can beat `terminal.create`'s response, before this instance knows which page-owned PTY is its
		// own. The bounded pre-bind buffer filters on adoption and becomes inert on bind/failure.
		const prebind = createTerminalPrebindBuffer();
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
			const id = serverIdRef.current;
			if (id) sendTerminalWrite(getTransport().request("terminal.write", { id, data }));
		});

		// The shell exited (the user typed `exit`, or it crashed). Until the host said so, the tab went on
		// looking alive — cursor blinking, keystrokes accepted — while every keystroke was written to a dead id
		// and silently dropped, with no way to tell.
		const handleExit = (ev: TerminalExitPush): void => {
			if (ev.id !== serverIdRef.current) return;
			// Forget the id: there is nothing left to write to, to detach for a later mount, or to close.
			serverIdRef.current = null;
			detachedPtyByClientId.delete(clientId);
			term.write(`\r\n[process exited${ev.exitCode === 0 ? "" : ` with code ${ev.exitCode}`}]\r\n`);
			setExited(true);
		};
		const unsubscribeExit = getTransport().subscribe(WS_CHANNELS.terminalExit, (payload) => {
			const ev = payload as TerminalExitPush;
			if (prebind.acceptExit(ev)) return;
			handleExit(ev);
		});

		let disposed = false;

		// Our code font ships as per-alphabet woff2 subsets (`font-display: swap`), so the Cyrillic/CJK file
		// is only fetched once such a glyph is first drawn. xterm measures the character cell exactly once, at
		// construction, against whatever had loaded by then — and never re-measures (unlike Monaco, which
		// treats an early measurement as untrusted). Left alone, non-Latin text renders into cells sized for
		// the fallback font (drifting glyphs, a misplaced cursor) and the PTY holds the wrong cols/rows. The
		// addon re-measures once `document.fonts.ready` resolves; we await that ourselves rather than letting
		// its constructor fire it, so we know when to re-fit and push the corrected size to the shell.
		void webFonts
			.relayout()
			.then(() => {
				if (!disposed) applyFit();
			})
			.catch(() => {
				// A font that never resolves must not break the terminal — the construction-time fit stands.
			});

		/**
		 * Let go of a PTY: hand it to the registry if this tab outlived the instance, otherwise kill it. The
		 * store is the authority on "does the tab still exist" — closing a tab removes it *before* React
		 * unmounts the instance, so a genuine close is already absent here, while an incidental unmount
		 * (Project Home, a workspace switch) still finds it.
		 */
		const releasePty = (id: string): void => {
			const tabSurvives = useAppStore
				.getState()
				.terminalsByWorkspace[workspaceId]?.some((t) => t.clientId === clientId);
			if (tabSurvives) {
				detachedPtyByClientId.set(clientId, id);
				return;
			}
			detachedPtyByClientId.delete(clientId);
			void getTransport()
				.request("terminal.close", { id })
				.catch(() => {});
		};

		/** Bind to a PTY id: route its output here, catch up on ordered pre-bind events, and go ready. */
		const bindPty = (id: string): void => {
			serverIdRef.current = id;
			const buffered = prebind.bind(id);
			if (buffered.truncated) writeTruncation();
			for (const ev of buffered.frames) writeFrame(ev);
			setReady(true);
			// A very short-lived shell can send its addressed exit before the create response names its id.
			// Paint buffered data first, then apply that matching exit exactly as a live subscription would.
			if (buffered.exit) handleExit(buffered.exit);
		};

		/** Ask the host for a brand-new shell. */
		const createPty = (): void => {
			// The size the PTY is actually spawned at, captured NOW. Recording `term.cols` at resolve time instead
			// would bake in whatever the grid had since become, so a resize that landed while this request was in
			// flight would look already-applied and never be sent — leaving the shell permanently mis-sized.
			const spawnedAt = { cols: term.cols, rows: term.rows };
			void getTransport()
				.request("terminal.create", { workspaceId, ...spawnedAt })
				.then(({ id }) => {
					if (disposed) {
						// Close rather than detach: this shell was never bound, never produced output and holds no
						// user work, and a concurrent mount (React StrictMode remounts every effect in dev) has
						// already created its own. Detaching it would leak a second live shell per terminal open.
						void getTransport()
							.request("terminal.close", { id })
							.catch(() => {});
						return;
					}
					sizeSync.acknowledge(spawnedAt);
					bindPty(id);
					// Catch up if the grid moved while we were waiting; a no-op when it didn't.
					applyFit();
					if (serverIdRef.current === id && initialCommandRef.current)
						sendTerminalWrite(
							getTransport().request("terminal.write", {
								id,
								data: `${initialCommandRef.current}\r`,
							}),
						);
				})
				.catch(() => {
					if (disposed) return;
					// Reconnects replay this request, so this is a real host refusal or deadline rather than an
					// ambiguous dropped response. Stop pre-bind intake: this failed pane must not retain every other
					// terminal's page-addressed output for the rest of its life.
					prebind.stop();
					term.write("\r\n[could not start a shell — close this tab and open a new one]\r\n");
					setFailed(true);
				});
		};

		const detached = detachedPtyByClientId.get(clientId);
		if (detached === undefined) {
			createPty();
		} else {
			detachedPtyByClientId.delete(clientId);
			// Re-attaching to a shell this tab detached earlier — but confirm it is still there first.
			// `terminal.exit` is only heard by a MOUNTED instance, and a detach happens precisely when none is
			// (Project Home unmounts the whole panel), so a shell that died while detached leaves a dead id here.
			// Adopting it blindly hands back a tab that looks alive and ready while every keystroke goes nowhere —
			// exactly the failure the exit event exists to prevent.
			void getTransport()
				.request("terminal.alive", { id: detached })
				.then(({ alive }) => {
					if (disposed) {
						// Unmounted mid-check: hand the shell back to the registry (or kill it) rather than leaking.
						if (alive) releasePty(detached);
						return;
					}
					if (!alive) {
						createPty();
						return;
					}
					// The shell kept the size it had while detached, which may no longer match this layout. The
					// scrollback is a fresh xterm buffer — the *process* survived, its painted history did not.
					bindPty(detached);
					applyFit();
				})
				.catch(() => {
					// The liveness check genuinely failed or timed out (socket loss itself is replayed). A fresh shell
					// is safer than presenting one we cannot vouch for. Best-effort kill the id we gave up on so it
					// is not left running with nothing pointing at it.
					void getTransport()
						.request("terminal.close", { id: detached })
						.catch(() => {});
					if (!disposed) createPty();
				});
		}

		const resizeObserver = new ResizeObserver(scheduleFit);
		resizeObserver.observe(host);

		const stopThemeWatch = onThemeSwap(() => {
			term.options.theme = readTheme();
		});

		return () => {
			disposed = true;
			prebind.stop();
			sizeSync.dispose();
			clearTimeout(fitTimer);
			resizeObserver.disconnect();
			stopThemeWatch();
			onData.dispose();
			unsubscribe();
			unsubscribeExit();
			const id = serverIdRef.current;
			if (id) releasePty(id);
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
			data-exited={exited}
			data-failed={failed}
			data-visible={visible}
			className={`absolute inset-0 ${visible ? "" : "hidden"}`}
		>
			<div ref={hostRef} className="h-full w-full" />
		</div>
	);
}
