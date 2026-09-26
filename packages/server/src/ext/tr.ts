import { extChannelKey, type PiEvent, type SessionStats } from "@thinkrail/contracts";
import type { ExtStore, PiEventName, PiEventOf, SessionRef, Tr } from "@thinkrail/ext";
import { type AgentBackend, createAgents } from "./agents";
import type { Generation } from "./generation";

export type WorkspaceReads = Tr["workspaces"];

export const NO_WORKSPACES: WorkspaceReads = { list: () => [], get: () => undefined };

export interface SessionReads {
	list(): SessionRef[];
	get(sessionId: string): SessionRef | undefined;
	stats(sessionId: string): SessionStats;
}

const isEventOf = <E extends PiEventName>(event: PiEvent, type: E): event is PiEventOf<E> =>
	event.type === type;

const formatArg = (arg: unknown) => {
	if (typeof arg === "string") return arg;
	if (arg instanceof Error) return arg.stack ?? arg.message;
	try {
		return JSON.stringify(arg);
	} catch {
		return String(arg);
	}
};

export const formatLog = (args: readonly unknown[]) => args.map(formatArg).join(" ");

export const createTr = ({
	name,
	dir,
	generation,
	store,
	sessions,
	workspaces,
	agents,
	watched,
	log,
}: {
	name: string;
	dir: string;
	generation: Generation;
	store: ExtStore;
	sessions: SessionReads;
	workspaces: WorkspaceReads;
	agents: AgentBackend;
	watched: () => string[];
	log: (level: "info" | "error", message: string) => void;
}): Tr => {
	const guard =
		<A extends unknown[]>(label: string, fn: (...args: A) => unknown) =>
		(...args: A) => {
			try {
				const result = fn(...args);
				if (result instanceof Promise)
					result.catch((error: unknown) => log("error", `${label}: ${formatArg(error)}`));
			} catch (error) {
				log("error", `${label}: ${formatArg(error)}`);
			}
		};
	return {
		name,
		dir,
		log: (...args) => log("info", formatLog(args)),
		on(type, fn) {
			const safe = guard(`on(${type})`, fn);
			return generation.addObserver(type, (event, session) => {
				if (isEventOf(event, type)) safe(event, session);
			});
		},
		pi: (factory) => generation.addPiFactory(factory),
		publish: (key, value) => generation.publish(extChannelKey(name, key), value),
		unpublish: (key) => generation.unpublish(extChannelKey(name, key)),
		watched,
		onWatch(fn) {
			const safe = guard("onWatch", fn);
			return generation.addWatchObserver((key, watching) => safe(key, watching));
		},
		action: (id, fn) => generation.addAction(id, fn),
		store,
		sessions: {
			list: () => sessions.list(),
			stats: async (sessionId) => sessions.stats(sessionId),
		},
		workspaces: {
			list: () => workspaces.list(),
			get: (workspaceId) => workspaces.get(workspaceId),
		},
		agents: createAgents({
			name,
			backend: agents,
			generation,
			log: (message) => log("error", message),
		}),
		every(ms, fn) {
			if (!Number.isFinite(ms) || ms < 10)
				throw new Error(`every(${ms}): interval must be >= 10ms`);
			const tick = guard("every", fn);
			return generation.addTimer(() => {
				const timer = setInterval(tick, ms);
				return () => clearInterval(timer);
			});
		},
	};
};
