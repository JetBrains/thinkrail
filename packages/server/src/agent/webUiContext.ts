import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { ExtUiRequest, ExtUiResponse } from "@thinkrail/contracts";

let publish: (request: ExtUiRequest) => void = () => {};
export function setExtUiPublisher(fn: (request: ExtUiRequest) => void): void {
	publish = fn;
}

let seq = 0;
const nextId = (): string => `extui_${++seq}`;

interface Pending {
	sessionId: string;
	finish: (value: string | boolean | null, dismiss: boolean) => void;
}
const pending = new Map<string, Pending>();

export function resolveExtUi(response: ExtUiResponse): void {
	pending.get(response.id)?.finish(response.value, false);
}

export function cancelExtUiForSession(sessionId: string): void {
	for (const entry of [...pending.values()]) {
		if (entry.sessionId === sessionId) entry.finish(null, true);
	}
}

export function notifyExtUi(
	sessionId: string,
	message: string,
	level: "info" | "warning" | "error",
): void {
	publish({ id: nextId(), sessionId, kind: "notify", message, level });
}

export function createWebUiContext(sessionId: string): ExtensionUIContext {
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

		onTerminalInput: () => () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setFooter: () => {},
		setHeader: () => {},
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
