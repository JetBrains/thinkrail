export const EXT_NAME = "project-notes";
export const SECTION = "project_notes";
export const CHANNEL_PREFIX = "notes:";
export const NOTES_LIMIT = 50;
export const TITLE_LIMIT = 80;
export const BODY_LIMIT = 4_000;
export const PROMPT_CAP = 6_000;
export const CHARS_PER_TOKEN = 4;

const PREAMBLE =
	"Project notes: rules and facts the user pinned for this project. Follow them unless the user says otherwise in this chat.";

export type NoteSource = "user" | "agent";

export interface Note {
	id: string;
	title: string;
	body: string;
	enabled: boolean;
	source: NoteSource;
	createdAt: number;
	updatedAt: number;
}

export type NoteDraft = Pick<Note, "title" | "body"> & Partial<Pick<Note, "id" | "enabled">>;

export type SaveResult = { ok: true; note: Note } | { ok: false; error: string };

export interface Injection {
	text: string;
	sent: string[];
	skipped: string[];
}

export interface AddNoteDetails {
	note: Note;
	sent: boolean;
}

export const channelKey = (projectId: string) => `${CHANNEL_PREFIX}${projectId}`;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isNote = (value: unknown): value is Note =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.title === "string" &&
	typeof value.body === "string" &&
	typeof value.enabled === "boolean" &&
	(value.source === "user" || value.source === "agent") &&
	typeof value.createdAt === "number" &&
	typeof value.updatedAt === "number";

export const isNoteDraft = (value: unknown): value is NoteDraft =>
	isRecord(value) &&
	typeof value.title === "string" &&
	typeof value.body === "string" &&
	(value.id === undefined || typeof value.id === "string") &&
	(value.enabled === undefined || typeof value.enabled === "boolean");

export const isSaveResult = (value: unknown): value is SaveResult =>
	isRecord(value) &&
	((value.ok === true && isNote(value.note)) ||
		(value.ok === false && typeof value.error === "string"));

export const isAddNoteDetails = (value: unknown): value is AddNoteDetails =>
	isRecord(value) && isNote(value.note) && typeof value.sent === "boolean";

export const idPayload = (value: unknown) =>
	isRecord(value) && typeof value.id === "string" ? value.id : undefined;

export const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

export const titleOf = (note: Pick<Note, "title" | "body">) =>
	note.title.trim() || note.body.trim().split("\n")[0]?.slice(0, TITLE_LIMIT) || "Untitled";

export const noteText = (note: Pick<Note, "title" | "body">) =>
	`## ${titleOf(note)}\n${note.body.trim()}`;

export const validateDraft = (draft: NoteDraft) => {
	const title = draft.title.trim();
	const body = draft.body.trim();
	if (!body) return { ok: false as const, error: "Write the note first." };
	if (title.length > TITLE_LIMIT)
		return { ok: false as const, error: `Keep the title under ${TITLE_LIMIT} characters.` };
	if (body.length > BODY_LIMIT)
		return { ok: false as const, error: `Keep the note under ${BODY_LIMIT} characters.` };
	return { ok: true as const, title, body };
};

export const planInjection = (notes: readonly Note[], cap = PROMPT_CAP): Injection => {
	const parts: string[] = [];
	const sent: string[] = [];
	const skipped: string[] = [];
	let used = PREAMBLE.length;
	for (const note of notes) {
		if (!note.enabled) continue;
		const text = noteText(note);
		const cost = text.length + 2;
		if (skipped.length > 0 || used + cost > cap) {
			skipped.push(note.id);
			continue;
		}
		parts.push(text);
		sent.push(note.id);
		used += cost;
	}
	return { text: sent.length > 0 ? [PREAMBLE, ...parts].join("\n\n") : "", sent, skipped };
};

export const clip = (text: string, limit: number) =>
	text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
