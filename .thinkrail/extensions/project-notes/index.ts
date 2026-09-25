import { randomUUID } from "node:crypto";
import { sep } from "node:path";
import { defineExtension } from "@thinkrail/ext";
import {
	CHANNEL_PREFIX,
	channelKey,
	idPayload,
	isNote,
	isNoteDraft,
	NOTES_LIMIT,
	type Note,
	type NoteDraft,
	type NoteSource,
	planInjection,
	type SaveResult,
	validateDraft,
} from "./model";
import { type AgentAdd, notesPi, type SessionTarget } from "./pi";

const NO_PROJECT = { ok: false, error: "Open a project first." } as const;

export default defineExtension((tr) => {
	const cache = new Map<string, Note[]>();

	const load = async (projectId: string) => {
		const cached = cache.get(projectId);
		if (cached) return cached;
		const stored = await tr.store.get<unknown>(channelKey(projectId));
		const loaded = Array.isArray(stored) ? stored.filter(isNote).slice(0, NOTES_LIMIT) : [];
		const raced = cache.get(projectId);
		if (raced) return raced;
		cache.set(projectId, loaded);
		return loaded;
	};

	const queues = new Map<string, Promise<unknown>>();

	const serial = <T>(projectId: string, run: () => Promise<T>) => {
		const next = (queues.get(projectId) ?? Promise.resolve()).then(run, run);
		queues.set(
			projectId,
			next.catch(() => undefined),
		);
		return next;
	};

	const commit = async (projectId: string, notes: Note[]) => {
		cache.set(projectId, notes);
		const key = channelKey(projectId);
		if (tr.watched().includes(key)) tr.publish(key, notes);
		await tr.store.set(key, notes.length > 0 ? notes : undefined);
	};

	const projectOf = ({ sessionId, cwd }: SessionTarget) => {
		const session = tr.sessions.list().find((ref) => ref.sessionId === sessionId);
		const workspace = session ? tr.workspaces.get(session.workspaceId) : undefined;
		if (workspace) return workspace.projectId;
		const inside = tr.workspaces
			.list()
			.filter((ref) => cwd === ref.path || cwd.startsWith(`${ref.path}${sep}`))
			.sort((a, b) => b.path.length - a.path.length);
		return inside[0]?.projectId;
	};

	const saveNow = async (
		projectId: string,
		draft: NoteDraft,
		source: NoteSource,
	): Promise<SaveResult> => {
		const valid = validateDraft(draft);
		if (!valid.ok) return valid;
		const notes = await load(projectId);
		const now = Date.now();
		const existing = draft.id ? notes.find((note) => note.id === draft.id) : undefined;
		if (draft.id && !existing) return { ok: false, error: "That note no longer exists." };
		if (!existing && notes.length >= NOTES_LIMIT)
			return { ok: false, error: `A project keeps at most ${NOTES_LIMIT} notes.` };
		const note: Note = existing
			? {
					...existing,
					title: valid.title,
					body: valid.body,
					enabled: draft.enabled ?? existing.enabled,
					updatedAt: now,
				}
			: {
					id: randomUUID(),
					title: valid.title,
					body: valid.body,
					enabled: draft.enabled ?? true,
					source,
					createdAt: now,
					updatedAt: now,
				};
		await commit(
			projectId,
			existing ? notes.map((item) => (item.id === note.id ? note : item)) : [...notes, note],
		);
		return { ok: true, note };
	};

	const save = (projectId: string, draft: NoteDraft, source: NoteSource) =>
		serial(projectId, () => saveNow(projectId, draft, source));

	const update = (projectId: string, id: string, change: (notes: Note[]) => Note[]) =>
		serial(projectId, async () => {
			const notes = await load(projectId);
			if (!notes.some((note) => note.id === id)) return { ok: false };
			await commit(projectId, change(notes));
			return { ok: true };
		});

	tr.pi(
		notesPi({
			sectionFor: async (target) => {
				const projectId = projectOf(target);
				return projectId ? planInjection(await load(projectId)).text : "";
			},
			addForAgent: async (target, draft): Promise<AgentAdd> => {
				const projectId = projectOf(target);
				if (!projectId) return { ok: false, error: "This chat is not in a ThinkRail project." };
				const result = await save(projectId, draft, "agent");
				if (!result.ok) return result;
				tr.log(`agent added note ${result.note.id} to ${projectId}`);
				const sent = planInjection(await load(projectId)).sent.includes(result.note.id);
				return { ok: true, details: { note: result.note, sent } };
			},
		}),
	);

	tr.onWatch((key, watching) => {
		if (!key.startsWith(CHANNEL_PREFIX)) return;
		if (!watching) {
			tr.unpublish(key);
			return;
		}
		void load(key.slice(CHANNEL_PREFIX.length)).then((notes) => {
			if (tr.watched().includes(key)) tr.publish(key, notes);
		});
	});

	tr.action("save", (payload, ctx) => {
		if (!ctx.projectId) return NO_PROJECT;
		if (!isNoteDraft(payload)) return { ok: false, error: "Invalid note." };
		return save(ctx.projectId, payload, "user");
	});

	tr.action("toggle", (payload, ctx) => {
		const id = idPayload(payload);
		if (!ctx.projectId || !id) return { ok: false };
		return update(ctx.projectId, id, (notes) =>
			notes.map((note) =>
				note.id === id ? { ...note, enabled: !note.enabled, updatedAt: Date.now() } : note,
			),
		);
	});

	tr.action("remove", (payload, ctx) => {
		const id = idPayload(payload);
		if (!ctx.projectId || !id) return { ok: false };
		return update(ctx.projectId, id, (notes) => notes.filter((note) => note.id !== id));
	});

	return undefined;
});
