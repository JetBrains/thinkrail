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
const messageRenderers = new Map<string, MessageRenderer>();
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

export const registerMessageRenderer = (customType: string, renderer: MessageRenderer) => {
	const previous = messageRenderers.get(customType);
	messageRenderers.set(customType, renderer);
	bumpRendererRegistry();
	return () => {
		if (messageRenderers.get(customType) !== renderer) return;
		if (previous) messageRenderers.set(customType, previous);
		else messageRenderers.delete(customType);
		bumpRendererRegistry();
	};
};

const readMessageRenderer = (customType: string) => () => messageRenderers.get(customType);

export const useMessageRenderer = (customType: string) =>
	useSyncExternalStore(
		subscribeRendererRegistry,
		readMessageRenderer(customType),
		readMessageRenderer(customType),
	);
