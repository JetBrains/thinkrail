import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ExtActionContext, PiEvent, SessionStats } from "@thinkrail/contracts";

export type { SessionStats };

export type Off = () => void;
export type Disposer = () => void | Promise<void>;
export type PiExtensionFactory = ExtensionFactory;
export type PiEventName = PiEvent["type"];
export type PiEventOf<E extends PiEventName> = Extract<PiEvent, { type: E }>;

export interface SessionRef {
	sessionId: string;
	workspaceId: string;
	title: string;
	isStreaming: boolean;
}

export type ActionCtx = ExtActionContext;

export type ActionHandler = (payload: unknown, ctx: ActionCtx) => unknown;

export interface ExtStore {
	get<T>(key: string): Promise<T | undefined>;
	set(key: string, value: unknown): Promise<void>;
}

export interface Tr {
	readonly name: string;
	readonly dir: string;
	log(...args: unknown[]): void;
	on<E extends PiEventName>(event: E, fn: (event: PiEventOf<E>, session: SessionRef) => void): Off;
	pi(factory: PiExtensionFactory): Off;
	publish(key: string, value: unknown): void;
	unpublish(key: string): void;
	action(id: string, fn: ActionHandler): Off;
	readonly store: ExtStore;
	readonly sessions: {
		list(): SessionRef[];
		stats(sessionId: string): Promise<SessionStats>;
	};
	every(ms: number, fn: () => void): Off;
}

export type ThinkRailExtension = (tr: Tr) => Disposer | undefined | Promise<Disposer | undefined>;

export const defineExtension = (factory: ThinkRailExtension) => factory;
