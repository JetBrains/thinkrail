import { type Project, sessionAttention, type Workspace, WS_CHANNELS } from "@thinkrail/contracts";
import type {
	KeyValueStore,
	RemoteSessionItem,
	RemoteSessionsController,
} from "@thinkrail/remote-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnectedHosts } from "./hostView";

export type ChatSection = "needsYou" | "running" | "done";

/** A session that neither waits on you nor works is left out unless it is one the phone saw finish. */
const sectionOf = (item: RemoteSessionItem): "needsYou" | "running" | null => {
	const attention = sessionAttention(item.record.state);
	return attention === null ? null : attention === "running" ? "running" : "needsYou";
};

export const sessionKey = (item: RemoteSessionItem): string =>
	`${item.hostKey}:${item.record.sessionId}`;

/** The Sessions tab's groups, in order: waiting on you (a question, an unread result or failure), working, then the ones that finished — `done`, newest first. */
export function chatSections(
	items: readonly RemoteSessionItem[],
	done: readonly string[] = [],
): { section: ChatSection; items: RemoteSessionItem[] }[] {
	const finished = done.flatMap((key) =>
		items.filter((item) => sessionKey(item) === key && sectionOf(item) === null),
	);
	return [
		...(["needsYou", "running"] as const).map((section) => ({
			section,
			items: items.filter((item) => sectionOf(item) === section),
		})),
		{ section: "done" as const, items: finished },
	].filter((group) => group.items.length > 0);
}

/** How many chats wait on you — the Sessions tab's badge. */
export const needsYouCount = (items: readonly RemoteSessionItem[]): number =>
	items.filter((item) => sectionOf(item) === "needsYou").length;

export const DONE_LIMIT = 20;

/** One step of the Done list: a session last seen waiting or working that no longer is goes on top; one active again leaves it. */
export function settleDone(
	seen: ReadonlySet<string>,
	done: readonly string[],
	items: readonly RemoteSessionItem[],
): { seen: ReadonlySet<string>; done: string[] } {
	const active = new Set(items.filter((item) => sectionOf(item) !== null).map(sessionKey));
	const finished = [...seen].filter((key) => !active.has(key));
	return {
		seen: active,
		done: [...finished, ...done.filter((key) => !finished.includes(key) && !active.has(key))].slice(
			0,
			DONE_LIMIT,
		),
	};
}

const DONE_KEY = "thinkrail.mobile.doneSessions";

const readDone = (store: KeyValueStore): string[] => {
	try {
		const parsed: unknown = JSON.parse(store.read(DONE_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
	} catch {
		return [];
	}
};

/** The Done list, kept on the device so a finished session stays findable until cleared. */
export function useDoneSessions(
	items: readonly RemoteSessionItem[],
	store: KeyValueStore,
): { done: readonly string[]; clear: () => void } {
	const [done, setDone] = useState<readonly string[]>(() => readDone(store));
	const seen = useRef<ReadonlySet<string>>(new Set());
	useEffect(() => {
		const next = settleDone(seen.current, done, items);
		seen.current = next.seen;
		if (next.done.join("\n") !== done.join("\n")) setDone(next.done);
	}, [items, done]);
	useEffect(() => store.write(DONE_KEY, JSON.stringify(done)), [done, store]);
	return { done, clear: () => setDone([]) };
}

export interface ChatPlace {
	project: Project;
	workspace: Workspace;
}

const placeKey = (hostKey: string, workspaceId: string) => `${hostKey}:${workspaceId}`;

const PLACE_PUSHES = [
	WS_CHANNELS.projectUpdated,
	WS_CHANNELS.workspaceCreated,
	WS_CHANNELS.workspaceUpdated,
	WS_CHANNELS.workspaceRemoved,
];

/** The chats' places read so far, and per computer why its last read failed (cleared by the next that lands). */
export interface PlaceBook {
	places: ReadonlyMap<string, ChatPlace>;
	failures: ReadonlyMap<string, string>;
}

export const EMPTY_PLACES: PlaceBook = { places: new Map(), failures: new Map() };

export function recordPlaces(
	book: PlaceBook,
	hostKey: string,
	outcome: { found: readonly ChatPlace[] } | { failed: string },
): PlaceBook {
	const failures = new Map(book.failures);
	if ("failed" in outcome) {
		failures.set(hostKey, outcome.failed);
		return { places: book.places, failures };
	}
	failures.delete(hostKey);
	const places = new Map(book.places);
	for (const place of outcome.found) places.set(placeKey(hostKey, place.workspace.id), place);
	return { places, failures };
}

/** A chat's place; else why its computer's read failed; else `undefined` while it loads. */
export const placeIn = (
	book: PlaceBook,
	item: RemoteSessionItem,
): ChatPlace | { failed: string } | undefined => {
	const place = book.places.get(placeKey(item.hostKey, item.record.workspaceId));
	if (place) return place;
	const failed = book.failures.get(item.hostKey);
	return failed === undefined ? undefined : { failed };
};

/**
 * The project and workspace each chat lives in, read once per host and project that has a chat
 * (`project.list`, `workspace.list`) and re-read on their pushes or `retry`; a chat whose place has not
 * arrived yet maps to `undefined`, one whose computer's read failed to the reason.
 */
export function useChatPlaces(
	controller: RemoteSessionsController,
	items: readonly RemoteSessionItem[],
): { placeOf: (item: RemoteSessionItem) => ReturnType<typeof placeIn>; retry: () => void } {
	const [book, setBook] = useState<PlaceBook>(EMPTY_PLACES);
	const [pushes, setPushes] = useState(0);
	const scope = [...new Set(items.map((item) => `${item.hostKey}\n${item.record.projectId}`))]
		.sort()
		.join("\t");
	const hostKeys = [...new Set(items.map((item) => item.hostKey))].sort();
	/** The computers among them with a channel up; a read skipped while one was connecting runs once it is. */
	const connected = useConnectedHosts(controller, hostKeys);

	useEffect(() => {
		if (!connected) return;
		const bump = (): void => setPushes((count) => count + 1);
		const unsubscribes = connected.split("\t").flatMap((hostKey) => {
			const client = controller.clientFor(hostKey);
			return client ? PLACE_PUSHES.map((channel) => client.subscribe(channel, bump)) : [];
		});
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
		};
	}, [controller, connected]);

	useEffect(() => {
		if (!scope) return;
		let live = true;
		const byHost = new Map<string, string[]>();
		for (const entry of scope.split("\t")) {
			const [hostKey = "", projectId = ""] = entry.split("\n");
			byHost.set(hostKey, [...(byHost.get(hostKey) ?? []), projectId]);
		}
		for (const [hostKey, projectIds] of byHost) {
			const client = controller.clientFor(hostKey);
			if (!client) continue;
			void client
				.request<Project[]>("project.list", {})
				.then((projects) =>
					Promise.all(
						projects
							.filter((project) => projectIds.includes(project.id))
							.map((project) =>
								client
									.request<Workspace[]>("workspace.list", {
										projectId: project.id,
										includeDiffStats: false,
									})
									.then((workspaces) => workspaces.map((workspace) => ({ project, workspace }))),
							),
					),
				)
				.then(
					(found) => {
						if (live) setBook((current) => recordPlaces(current, hostKey, { found: found.flat() }));
					},
					(error: unknown) => {
						const failed = error instanceof Error ? error.message : String(error);
						if (live) setBook((current) => recordPlaces(current, hostKey, { failed }));
					},
				);
		}
		return () => {
			live = false;
		};
	}, [controller, scope, connected, pushes]);

	const retry = useCallback(() => setPushes((count) => count + 1), []);
	return { placeOf: (item) => placeIn(book, item), retry };
}
