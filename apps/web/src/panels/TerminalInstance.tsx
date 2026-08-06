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
import { getTransport } from "../transport";

/**
 * PTY ids left behind by unmounted instances, keyed by tab `clientId`.
 *
 * An instance unmounts for two very different reasons. Its **tab was closed** — the PTY should die. Or **the
 * surface it lives on went away while the tab survived**: the shell only mounts `TerminalsPanel` while a
 * workspace is active (`shell/Shell.tsx`), so every visit to Project Home unmounts every terminal of every
 * workspace. Killing the PTY in that second case silently kills whatever was running in it — a dev server, a
 * watch build — with no warning and no visible cause.
 *
 * So unmount hands the id here instead, and the next mount adopts it. Resuming needs no server round-trip at
 * all: `terminal.data` is keyed by PTY id, so re-subscribing to the same id reconnects the stream. Module
 * scope is the point — the registry has to outlive the component.
 *
 * The registry only ever holds *detached* PTYs: adopting removes the entry, and a genuinely closed tab is
 * reaped rather than registered. A PTY orphaned by a page reload is reaped host-side when its socket drops.
 * One entry can go stale — a workspace removed *while* its terminals are detached has no mounted instance to
 * run the reap — but the host kills those PTYs itself on archive, and `clientId` is a fresh UUID per tab, so a
 * stale entry can never be adopted by a later tab. It costs a dangling string until reload, nothing more.
 */
const detachedPtyByClientId = new Map<string, string>();

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
	const [ready, setReady] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-once; clientId/workspaceId are stable per instance
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
		// Fit once synchronously so `term.cols/rows` are the real grid by the time we ask for a PTY — a shell
		// born at the wrong size prints its first prompt for the wrong width and then reflows. No-ops (leaving
		// xterm's 80×24 default) if this layer isn't laid out yet, which the rAF below then corrects.
		applyFit();
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

		const detached = detachedPtyByClientId.get(clientId);
		if (detached !== undefined) {
			// Re-attaching to our own still-running shell. Set the id synchronously so the subscription above
			// starts routing its output immediately (nothing can arrive in between). The scrollback is a fresh
			// xterm buffer — the *process* survived, its painted history did not.
			detachedPtyByClientId.delete(clientId);
			serverIdRef.current = detached;
			void getTransport().request("terminal.resize", {
				id: detached,
				cols: term.cols,
				rows: term.rows,
			});
			setReady(true);
		} else {
			void getTransport()
				.request("terminal.create", { workspaceId, cols: term.cols, rows: term.rows })
				.then(({ id }) => {
					if (disposed) {
						releasePty(id);
						return;
					}
					serverIdRef.current = id;
					for (const ev of early) if (ev.id === id) term.write(ev.data);
					early.length = 0;
					void getTransport().request("terminal.resize", { id, cols: term.cols, rows: term.rows });
					if (initialCommand)
						void getTransport().request("terminal.write", { id, data: `${initialCommand}\r` });
					setReady(true);
				})
				.catch(() => {});
		}

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
			data-visible={visible}
			className={`absolute inset-0 ${visible ? "" : "hidden"}`}
		>
			<div ref={hostRef} className="h-full w-full" />
		</div>
	);
}
