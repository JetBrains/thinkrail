import type { PiEvent } from "@thinkrail/contracts";
import { getSessionWorkspaceId } from "../agent";
import {
	type AdditionalAnalyticsCapture,
	type AdditionalAnalyticsEvent,
	bucketCount,
	bucketDuration,
} from "../analytics";
import { getWorkspace } from "../workspaces";
import { sessionProviderAnalytics } from "./authAnalytics";
import { additionalCapture, captureAdditional } from "./productAnalytics";

type RunProperties = Extract<AdditionalAnalyticsEvent, { name: "agent_run_started" }>["params"];
type RunOutcome = Extract<
	AdditionalAnalyticsEvent,
	{ name: "agent_run_settled" }
>["params"]["outcome"];
type Origin = RunProperties["origin"];

interface SendIntent {
	capture: AdditionalAnalyticsCapture | null;
	origin: Origin;
	state: "pending" | "accepted" | "cleared";
}

interface ObservedRun {
	capture: AdditionalAnalyticsCapture;
	properties: RunProperties;
	startedAt: number;
	retries: number;
	compactions: number;
}

export function runOutcome(event: Extract<PiEvent, { type: "agent_settled" }>): RunOutcome {
	switch (event.terminal?.stopReason) {
		case undefined:
			return "no_terminal";
		case "stop":
			return "normal_stop";
		case "error":
			return "error";
		case "length":
			return "truncated";
		case "aborted":
			return "aborted";
		default:
			return "other";
	}
}

function combineOrigin(left: Origin, right: Origin): Origin {
	if (left === right) return left;
	if (left === "unknown" || right === "unknown") return "unknown";
	return "mixed";
}

function describeRun(sessionId: string): Omit<RunProperties, "origin"> | null {
	const workspaceId = getSessionWorkspaceId(sessionId);
	if (!workspaceId) return null;
	const workspace = getWorkspace(workspaceId);
	const bucket = sessionProviderAnalytics(sessionId);
	return {
		workspace_kind:
			workspace.kind === "default" || workspace.kind === "external" ? workspace.kind : "managed",
		provider: bucket.provider,
		model: bucket.model,
	};
}

export class RunObservation {
	private grant: AdditionalAnalyticsCapture | null = null;
	private readonly runs = new Map<string, ObservedRun>();
	private readonly activeSessions = new Set<string>();
	private readonly intents = new Map<string, Set<SendIntent>>();

	constructor(
		private readonly getCapture = additionalCapture,
		private readonly describe = describeRun,
		private readonly now = Date.now,
	) {}

	clear(): void {
		this.runs.clear();
		this.grant = null;
	}

	reset(): void {
		this.clear();
		this.activeSessions.clear();
		this.intents.clear();
	}

	forget(sessionId: string): void {
		this.runs.delete(sessionId);
		this.activeSessions.delete(sessionId);
		this.intents.delete(sessionId);
	}

	clearQueue(sessionId: string): void {
		const pending = this.intents.get(sessionId);
		if (!pending) return;
		for (const intent of pending) {
			if (intent.state === "accepted") pending.delete(intent);
			else intent.state = "cleared";
		}
		if (pending.size === 0) this.intents.delete(sessionId);
	}

	private currentCapture(): AdditionalAnalyticsCapture | null {
		const capture = this.getCapture();
		if (capture !== this.grant) {
			this.runs.clear();
			this.grant = capture;
		}
		return capture;
	}

	send<T>(sessionId: string, origin: "user" | "internal", operation: () => Promise<T>): Promise<T> {
		const capture = this.currentCapture();
		const intent: SendIntent = { capture, origin: capture ? origin : "unknown", state: "pending" };
		let pending = this.intents.get(sessionId);
		if (!pending) {
			pending = new Set();
			this.intents.set(sessionId, pending);
		}
		pending.add(intent);
		const run = this.runs.get(sessionId);
		const cleanup = () => {
			pending.delete(intent);
			if (pending.size === 0 && this.intents.get(sessionId) === pending)
				this.intents.delete(sessionId);
		};
		try {
			return operation().then(
				(result) => {
					const cleared = intent.state === "cleared";
					intent.state = "accepted";
					if (
						!cleared &&
						capture &&
						run &&
						this.runs.get(sessionId) === run &&
						capture === this.currentCapture()
					)
						run.properties.origin = combineOrigin(run.properties.origin, origin);
					if (cleared || this.activeSessions.has(sessionId)) cleanup();
					return result;
				},
				(error) => {
					cleanup();
					throw error;
				},
			);
		} catch (error) {
			cleanup();
			throw error;
		}
	}

	observe(sessionId: string, event: PiEvent): void {
		try {
			const capture = this.currentCapture();
			const starting = event.type === "agent_start" && !this.activeSessions.has(sessionId);
			const intents = starting ? [...(this.intents.get(sessionId) ?? [])] : [];
			if (event.type === "agent_start") this.activeSessions.add(sessionId);
			if (event.type === "agent_settled") this.activeSessions.delete(sessionId);
			if (starting || event.type === "agent_settled") this.intents.delete(sessionId);
			if (!capture) return;
			if (starting) {
				if (intents.some((intent) => intent.capture !== capture)) return;
				const description = this.describe(sessionId);
				if (!description) return;
				const origin = intents
					.map((intent) => intent.origin)
					.reduce(combineOrigin, intents[0]?.origin ?? "unknown");
				const properties: RunProperties = {
					origin,
					workspace_kind: description.workspace_kind,
					provider: description.provider,
					model: description.model,
				};
				this.runs.set(sessionId, {
					capture,
					properties,
					startedAt: this.now(),
					retries: 0,
					compactions: 0,
				});
				captureAdditional(capture, {
					name: "agent_run_started",
					params: {
						origin,
						workspace_kind: properties.workspace_kind,
						provider: properties.provider,
						model: properties.model,
					},
				});
				return;
			}
			const run = this.runs.get(sessionId);
			if (!run) return;
			if (event.type === "auto_retry_start") run.retries += 1;
			if (event.type === "compaction_start") run.compactions += 1;
			if (event.type !== "agent_settled") return;
			this.runs.delete(sessionId);
			captureAdditional(run.capture, {
				name: "agent_run_settled",
				params: {
					origin: run.properties.origin,
					workspace_kind: run.properties.workspace_kind,
					provider: run.properties.provider,
					model: run.properties.model,
					outcome: runOutcome(event),
					duration_bucket: bucketDuration(this.now() - run.startedAt),
					retry_bucket: bucketCount(run.retries),
					compaction_bucket: bucketCount(run.compactions),
				},
			});
		} catch {}
	}
}

export const runObservation = new RunObservation();
