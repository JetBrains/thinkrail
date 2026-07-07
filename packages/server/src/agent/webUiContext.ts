// The in-process bridge for pi's extension UI: `pi` calls `uiContext.select/confirm/input/editor` while a
// turn runs; we push an `ExtUiRequest` on the `pi.extensionUi` WS channel and resolve the awaiting promise
// when the browser replies. `notify`/`setStatus`/`setWidget`/`setTitle` are fire-and-forget pushes. The
// TUI-only members of `ExtensionUIContext` are inert no-ops — pi never invokes them in `rpc` (non-TUI) mode.

import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest, ExtUiResponse } from "@thinkrail/contracts";

let publish: (request: ExtUiRequest) => void = () => {};
/** Wired in `createServer` to push frames on the `pi.extensionUi` channel (defaults to a no-op). */
export function setExtUiPublisher(fn: (request: ExtUiRequest) => void): void {
	publish = fn;
}

let seq = 0;
const nextId = (): string => `extui_${++seq}`;

/** A dialog awaiting the browser's reply. `finish` settles the promise (and optionally tells the UI to close). */
interface Pending {
	sessionId: string;
	finish: (value: string | boolean | null, dismiss: boolean) => void;
}
const pending = new Map<string, Pending>();

/** The browser's reply to a dialog `ExtUiRequest` — resolves the awaiting `uiContext` promise. */
export function resolveExtUi(response: ExtUiResponse): void {
	pending.get(response.id)?.finish(response.value, false);
}

/** Settle every dialog awaiting on a session as cancelled (+ dismiss it in the UI) — used when it's disposed. */
export function cancelExtUiForSession(sessionId: string): void {
	for (const entry of [...pending.values()]) {
		if (entry.sessionId === sessionId) entry.finish(null, true);
	}
}

/** Push a fire-and-forget notification (e.g. an extension load/runtime error) to a session's client. */
export function notifyExtUi(
	sessionId: string,
	message: string,
	level: "info" | "warning" | "error",
): void {
	publish({ id: nextId(), sessionId, kind: "notify", message, level });
}

/** Build the `uiContext` for one session: dialogs round-trip to its client, everything else is inert. */
export function createWebUiContext(sessionId: string): ExtensionUIContext {
	// Push a dialog request and await the browser's reply; honor abort/timeout so a turn that's aborted
	// (or a slow user) never leaves the promise — or the on-screen dialog — hanging forever.
	const bridgeDialog = (
		request: ExtUiRequest,
		opts?: ExtensionUIDialogOptions,
	): Promise<string | boolean | null> =>
		new Promise((resolve) => {
			const { id } = request;
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (value: string | boolean | null, dismiss: boolean): void => {
				if (settled) return;
				settled = true;
				pending.delete(id);
				if (timer) clearTimeout(timer);
				opts?.signal?.removeEventListener("abort", onAbort);
				if (dismiss) publish({ id, sessionId, kind: "dismiss" });
				resolve(value);
			};
			const onAbort = (): void => finish(null, true);
			pending.set(id, { sessionId, finish });
			if (opts?.signal) {
				if (opts.signal.aborted) return finish(null, true);
				opts.signal.addEventListener("abort", onAbort, { once: true });
			}
			if (typeof opts?.timeout === "number")
				timer = setTimeout(() => finish(null, true), opts.timeout);
			publish(request);
		});

	// One localized seam: the TUI `Theme` value pi exposes via `ctx.ui.theme` — unused in rpc mode, present
	// only to satisfy the type. (Avoids importing the heavy pi-tui `Theme` symbol just for a stub.)
	const inertTheme = {} as ExtensionUIContext["theme"];

	return {
		async select(title, options, opts) {
			const v = await bridgeDialog(
				{ id: nextId(), sessionId, kind: "select", title, options },
				opts,
			);
			return typeof v === "string" ? v : undefined;
		},
		async confirm(title, message, opts) {
			return (
				(await bridgeDialog({ id: nextId(), sessionId, kind: "confirm", title, message }, opts)) ===
				true
			);
		},
		async input(title, placeholder, opts) {
			const v = await bridgeDialog(
				{ id: nextId(), sessionId, kind: "input", title, ...(placeholder ? { placeholder } : {}) },
				opts,
			);
			return typeof v === "string" ? v : undefined;
		},
		async editor(title, prefill) {
			const v = await bridgeDialog({
				id: nextId(),
				sessionId,
				kind: "editor",
				title,
				...(prefill ? { prefill } : {}),
			});
			return typeof v === "string" ? v : undefined;
		},
		notify(message, type) {
			publish({ id: nextId(), sessionId, kind: "notify", message, level: type ?? "info" });
		},
		setStatus(key, text) {
			publish({ id: nextId(), sessionId, kind: "setStatus", key, text: text ?? null });
		},
		setWidget(key, content) {
			publish({
				id: nextId(),
				sessionId,
				kind: "setWidget",
				key,
				content: Array.isArray(content) ? content : null,
			});
		},
		setTitle(title) {
			publish({ id: nextId(), sessionId, kind: "setTitle", title });
		},

		// TUI-only members — inert in rpc mode. Present so the object satisfies `ExtensionUIContext`.
		onTerminalInput: () => () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setFooter: () => {},
		setHeader: () => {},
		// Unsupported over the wire — degrade to undefined (pi's own rpc-mode no-op), not a thrown error.
		custom: (() => Promise.resolve(undefined)) as ExtensionUIContext["custom"],
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		theme: inertTheme,
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: true }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	} satisfies ExtensionUIContext;
}
