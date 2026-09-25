import { defineExtension } from "@thinkrail/ext";
import { createTimeline, isTimeline, reduceTimeline, type Timeline, TRACKED_EVENTS } from "./model";

const FLUSH_MS = 150;
const SWEEP_MS = 30_000;
const ARCHIVE_SESSIONS = 12;
const INDEX_KEY = "sessions";
const archiveKey = (sessionId: string) => `timeline:${sessionId}`;

export default defineExtension(async (tr) => {
	const live = new Map<string, Timeline>();
	const archive = new Map<string, Timeline>();
	const dirty = new Set<string>();

	const storedIds = await tr.store.get<string[]>(INDEX_KEY);
	for (const sessionId of Array.isArray(storedIds) ? storedIds : []) {
		const stored = await tr.store.get<unknown>(archiveKey(sessionId));
		if (isTimeline(stored)) archive.set(sessionId, stored);
	}

	const timelineOf = (sessionId: string) =>
		live.get(sessionId) ?? archive.get(sessionId) ?? createTimeline(sessionId);

	const flush = (sessionId: string) => {
		dirty.delete(sessionId);
		const timeline = live.get(sessionId) ?? archive.get(sessionId);
		if (timeline) tr.publish(sessionId, timeline);
	};

	const publishCost = (sessionId: string) =>
		tr.sessions
			.stats(sessionId)
			.then((stats) => tr.publish(`cost:${sessionId}`, stats))
			.catch((error: unknown) => tr.log(`stats ${sessionId} unavailable`, error));

	const persist = async (timeline: Timeline) => {
		archive.delete(timeline.sessionId);
		archive.set(timeline.sessionId, timeline);
		const evicted = [...archive.keys()].slice(0, Math.max(0, archive.size - ARCHIVE_SESSIONS));
		for (const sessionId of evicted) {
			archive.delete(sessionId);
			await tr.store.set(archiveKey(sessionId), undefined);
		}
		await tr.store.set(archiveKey(timeline.sessionId), timeline);
		await tr.store.set(INDEX_KEY, [...archive.keys()]);
	};

	for (const type of TRACKED_EVENTS)
		tr.on(type, (event, session) => {
			const { sessionId } = session;
			const next = reduceTimeline(timelineOf(sessionId), event, Date.now());
			live.set(sessionId, next);
			dirty.add(sessionId);
			if (event.type === "turn_end") void publishCost(sessionId);
			if (event.type !== "agent_settled") return;
			flush(sessionId);
			void publishCost(sessionId);
			void persist(next).catch((error: unknown) => tr.log("persist failed", error));
		});

	tr.every(FLUSH_MS, () => {
		for (const sessionId of [...dirty]) flush(sessionId);
	});

	tr.every(SWEEP_MS, () => {
		const open = new Set(tr.sessions.list().map((session) => session.sessionId));
		for (const sessionId of [...live.keys()]) {
			if (open.has(sessionId)) continue;
			live.delete(sessionId);
			dirty.delete(sessionId);
			tr.unpublish(sessionId);
			tr.unpublish(`cost:${sessionId}`);
		}
	});

	tr.action("watch", (_payload, ctx) => {
		const { sessionId } = ctx;
		if (!sessionId) return { watching: false };
		flush(sessionId);
		void publishCost(sessionId);
		return { watching: true };
	});

	tr.action("clear", async (_payload, ctx) => {
		const { sessionId } = ctx;
		if (!sessionId) return { cleared: false };
		const current = timelineOf(sessionId);
		live.set(sessionId, {
			...current,
			spans: current.spans.filter((span) => span.status === "running"),
			dropped: 0,
		});
		flush(sessionId);
		if (archive.delete(sessionId)) {
			await tr.store.set(archiveKey(sessionId), undefined);
			await tr.store.set(INDEX_KEY, [...archive.keys()]);
		}
		return { cleared: true };
	});

	for (const session of tr.sessions.list()) {
		flush(session.sessionId);
		void publishCost(session.sessionId);
	}
	return undefined;
});
