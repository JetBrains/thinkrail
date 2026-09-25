import { type ReactNode, useSyncExternalStore } from "react";

export interface MessageRenderProps {
	customType: string;
	text: string;
	details: unknown;
	timestamp: number;
}

export type MessageRenderer = (props: MessageRenderProps) => ReactNode;

export interface RendererRegistrySnapshot {
	version: number;
	messageTypes: ReadonlySet<string>;
}

const listeners = new Set<() => void>();

export const createStackRegistry = <T>(onChange: () => void) => {
	const stacks = new Map<string, { entry: T }[]>();
	const register = (key: string, entry: T) => {
		const slot = { entry };
		stacks.set(key, [...(stacks.get(key) ?? []), slot]);
		onChange();
		return () => {
			const stack = stacks.get(key);
			if (!stack?.includes(slot)) return;
			const rest = stack.filter((candidate) => candidate !== slot);
			if (rest.length > 0) stacks.set(key, rest);
			else stacks.delete(key);
			onChange();
		};
	};
	return {
		register,
		get: (key: string) => stacks.get(key)?.at(-1)?.entry,
		keys: () => stacks.keys(),
	};
};

const messageRenderers = createStackRegistry<MessageRenderer>(() => bumpRendererRegistry());
let snapshot: RendererRegistrySnapshot = { version: 0, messageTypes: new Set() };

export const bumpRendererRegistry = () => {
	snapshot = { version: snapshot.version + 1, messageTypes: new Set(messageRenderers.keys()) };
	for (const listener of listeners) listener();
};

export const subscribeRendererRegistry = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

const getSnapshot = () => snapshot;

export const useRendererRegistry = () =>
	useSyncExternalStore(subscribeRendererRegistry, getSnapshot, getSnapshot);

export const registerMessageRenderer = (customType: string, renderer: MessageRenderer) =>
	messageRenderers.register(customType, renderer);

export const getMessageRenderer = (customType: string) => messageRenderers.get(customType);

const readMessageRenderer = (customType: string) => () => getMessageRenderer(customType);

export const useMessageRenderer = (customType: string) =>
	useSyncExternalStore(
		subscribeRendererRegistry,
		readMessageRenderer(customType),
		readMessageRenderer(customType),
	);
