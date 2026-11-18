import { useSyncExternalStore } from "react";

export interface DockState {
	collapsed: boolean;
	focusRequest: number;
}

const OPEN: DockState = { collapsed: false, focusRequest: 0 };
const states = new Map<string, DockState>();
const listeners = new Set<() => void>();

function update(toolCallId: string, next: DockState): void {
	states.set(toolCallId, next);
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function dockState(toolCallId: string): DockState {
	return states.get(toolCallId) ?? OPEN;
}

export function useDockState(toolCallId: string): DockState {
	return useSyncExternalStore(
		subscribe,
		() => dockState(toolCallId),
		() => dockState(toolCallId),
	);
}

export function setDockCollapsed(toolCallId: string, collapsed: boolean): void {
	const current = dockState(toolCallId);
	if (current.collapsed !== collapsed) update(toolCallId, { ...current, collapsed });
}

export function requestDockFocus(toolCallId: string): void {
	const current = dockState(toolCallId);
	update(toolCallId, { collapsed: false, focusRequest: current.focusRequest + 1 });
}

export function forgetDockState(toolCallId: string): void {
	states.delete(toolCallId);
}
