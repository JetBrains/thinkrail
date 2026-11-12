import type { SessionEventPayload } from "@thinkrail/contracts";
import type { SendOutcome } from "./socketSend";

export function snapshotKey({ sessionId, event }: SessionEventPayload): string | undefined {
	if (event.type === "tool_execution_update") {
		return JSON.stringify([sessionId, "tool", event.toolCallId]);
	}
	if (event.type === "message_update" && "partial" in event.assistantMessageEvent) {
		return JSON.stringify([sessionId, "message"]);
	}
	return undefined;
}

export interface SnapshotSocket {
	quarantined(): boolean;
	getBufferedAmount(): number;
	send(frame: string): SendOutcome;
}

export type HeldFlush = "idle" | "waiting" | "flushed" | "backpressured" | "dropped";

export function terminalsMayResume(flush: HeldFlush | undefined): boolean {
	return flush === undefined || flush === "idle" || flush === "flushed";
}

export class HeldSnapshots {
	private readonly held = new Map<string, { sessionId: string; frame: string }>();
	private readonly socket: SnapshotSocket;

	constructor(socket: SnapshotSocket) {
		this.socket = socket;
	}

	get size(): number {
		return this.held.size;
	}

	deliver(payload: SessionEventPayload, frame: string): SendOutcome | "held" {
		if (this.socket.quarantined()) {
			this.held.clear();
			return "dropped";
		}
		const key = snapshotKey(payload);
		if (key !== undefined) {
			this.held.delete(key);
			if (this.socket.getBufferedAmount() > 0) {
				this.held.set(key, { sessionId: payload.sessionId, frame });
				return "held";
			}
		}
		if (!this.barrier(payload.sessionId)) return "dropped";
		const outcome = this.socket.send(frame);
		if (outcome === "dropped") this.held.clear();
		return outcome;
	}

	barrier(sessionId: string): boolean {
		for (const [key, entry] of this.held) {
			if (entry.sessionId !== sessionId) continue;
			this.held.delete(key);
			if (this.socket.send(entry.frame) === "dropped") {
				this.held.clear();
				return false;
			}
		}
		return true;
	}

	drain(): HeldFlush {
		if (this.held.size === 0) return "idle";
		if (this.socket.getBufferedAmount() > 0) return "waiting";
		for (const [key, entry] of this.held) {
			this.held.delete(key);
			const outcome = this.socket.send(entry.frame);
			if (outcome === "dropped") {
				this.held.clear();
				return "dropped";
			}
			if (outcome === "backpressured") return "backpressured";
		}
		return "flushed";
	}

	forgetSession(sessionId: string): void {
		for (const [key, entry] of this.held) if (entry.sessionId === sessionId) this.held.delete(key);
	}

	clear(): void {
		this.held.clear();
	}
}
