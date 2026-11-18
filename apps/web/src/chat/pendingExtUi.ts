import { useEffect, useMemo, useState } from "react";
import type { ExtUiReply, PendingExtUi } from "./ExtUiPrompt";
import type { ExtUiDialogRequest } from "./types";

function createExtUiPromptMemory(pendingAtMount: ExtUiDialogRequest | null) {
	const memory = new WeakMap<ExtUiDialogRequest, { draft?: string; revealClosed?: boolean }>();
	const entryFor = (request: ExtUiDialogRequest) => {
		const entry = memory.get(request) ?? {};
		memory.set(request, entry);
		return entry;
	};
	if (pendingAtMount) entryFor(pendingAtMount).revealClosed = true;
	return {
		draft: (request: ExtUiDialogRequest) => memory.get(request)?.draft,
		rememberDraft: (request: ExtUiDialogRequest, text: string) => {
			entryFor(request).draft = text;
		},
		revealOpen: (request: ExtUiDialogRequest) => !memory.get(request)?.revealClosed,
		closeReveal: (request: ExtUiDialogRequest) => {
			entryFor(request).revealClosed = true;
		},
	};
}

export function usePendingExtUi(
	request: ExtUiDialogRequest | null,
	reply: (request: ExtUiDialogRequest, value: Parameters<ExtUiReply>[0]) => void,
): PendingExtUi | null {
	const [memory] = useState(() => createExtUiPromptMemory(request));
	useEffect(() => {
		if (!request) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => memory.closeReveal(request));
		});
		return () => cancelAnimationFrame(frame);
	}, [request, memory]);
	return useMemo(
		() =>
			request
				? {
						request,
						reply: (value) => reply(request, value),
						draft: () => memory.draft(request),
						rememberDraft: (text) => memory.rememberDraft(request, text),
						revealOpen: () => memory.revealOpen(request),
						closeReveal: () => memory.closeReveal(request),
					}
				: null,
		[request, reply, memory],
	);
}
