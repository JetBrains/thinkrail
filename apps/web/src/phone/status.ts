import { type SessionState, sessionAttention } from "@thinkrail/contracts";
import type { RemoteSessionItem } from "@thinkrail/remote-client";

export interface ScopeStatus {
	running: boolean;
	attention: boolean;
}

export function statusOf(state: SessionState | undefined): ScopeStatus {
	const attention = state ? sessionAttention(state) : null;
	return {
		running: attention === "running",
		attention: attention !== null && attention !== "running",
	};
}

/** A project's or workspace's marks: running while any of its sessions runs, attention while any needs it. */
export function scopeStatus(
	items: readonly RemoteSessionItem[],
	inScope: (item: RemoteSessionItem) => boolean,
): ScopeStatus {
	const status: ScopeStatus = { running: false, attention: false };
	for (const item of items) {
		if (!inScope(item)) continue;
		const own = statusOf(item.record.state);
		status.running ||= own.running;
		status.attention ||= own.attention;
	}
	return status;
}
