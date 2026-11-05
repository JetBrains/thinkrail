import type { ChatTurn } from "@thinkrail/chat-ui/types";
import type {
	ExtUiRequest,
	ImageContent,
	PiEvent,
	ProviderWarning,
	SessionQueueContent,
	SessionQueueState,
} from "@thinkrail/contracts";

export const NO_QUEUE: SessionQueueState = { steering: [], followUp: [] };

/** The queue a `queue_update` reports, or undefined for any other event. */
export function queueOf(event: PiEvent): SessionQueueState | undefined {
	if (event.type !== "queue_update") return undefined;
	return {
		steering: event.steering,
		followUp: event.followUp,
		...(event.hasImages ? { hasImages: true as const } : {}),
	};
}

/** An extension's `notify`, kept on the phone only: it is pushed, never written to the transcript. */
export interface PhoneNote {
	id: string;
	kind: "system" | "error";
	text: string;
	/** The turn it arrived after, so a transcript re-read keeps it in place; null before the first turn. */
	after: string | null;
}

export type PhoneExtUi =
	| { kind: "note"; note: PhoneNote }
	| { kind: "notice"; notice: ProviderWarning }
	| null;

/** What a `pi.extensionUi` push for this session shows on the phone; dialogs come from `session.state`. */
export function phoneExtUi(
	request: ExtUiRequest,
	sessionId: string,
	after: string | null,
): PhoneExtUi {
	if (request.sessionId !== sessionId) return null;
	if (request.kind === "notify")
		return {
			kind: "note",
			note: {
				id: `note:${request.id}`,
				kind: request.level === "error" ? "error" : "system",
				text: request.message,
				after,
			},
		};
	if (request.kind === "notice") return { kind: "notice", notice: request.notice };
	return null;
}

/** The transcript's turns with each note placed after the turn it arrived after. */
export function withNotes(turns: ChatTurn[], notes: readonly PhoneNote[]): ChatTurn[] {
	if (notes.length === 0) return turns;
	const known = new Set(turns.map((turn) => turn.id));
	const asTurn = ({ id, kind, text }: PhoneNote): ChatTurn => ({ kind, id, text });
	const at = (anchor: string | null) => notes.filter((note) => note.after === anchor).map(asTurn);
	const result = [...at(null)];
	for (const turn of turns) result.push(turn, ...at(turn.id));
	for (const note of notes)
		if (note.after !== null && !known.has(note.after)) result.push(asTurn(note));
	return result;
}

/** Queued messages put back in the field, as the IDE does when one is edited or a run is stopped. */
export function queuedDraft(
	current: string,
	content: SessionQueueContent,
): { text: string; images: ImageContent[] } {
	const messages = [...content.steering, ...content.followUp];
	const text = [...messages.map((message) => message.text), current]
		.filter((part) => part.trim() !== "")
		.join("\n\n");
	return { text, images: messages.flatMap((message) => message.images ?? []) };
}
