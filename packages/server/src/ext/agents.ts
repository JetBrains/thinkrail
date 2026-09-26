import type {
	AgentEvent,
	AgentHandle,
	AgentParent,
	AgentProgress,
	AgentResult,
	AgentSpawnOptions,
	AgentSpec,
	AgentStatus,
	TrAgents,
} from "@thinkrail/ext";
import type {
	ChildHandle,
	DelegationRunDetails,
	DelegationService,
	RunOutcome,
	SessionOptions,
} from "pi-delegation";
import type { Generation } from "./generation";
import { errorMessage } from "./util";

export const DEFAULT_AGENT_CONCURRENCY = 4;
export const MAX_AGENT_CONCURRENCY = 16;

export interface AgentBackend {
	serviceFor(parentSessionId: string): DelegationService | undefined;
}

export const NO_AGENTS: AgentBackend = { serviceFor: () => undefined };

const parentIdOf = (parent: AgentParent) =>
	typeof parent === "string" ? parent : parent.sessionManager.getSessionId();

const concurrencyOf = (value: number | undefined) => {
	const max = value ?? DEFAULT_AGENT_CONCURRENCY;
	if (!Number.isInteger(max) || max < 1 || max > MAX_AGENT_CONCURRENCY)
		throw new Error(`maxConcurrent must be an integer from 1 to ${MAX_AGENT_CONCURRENCY}`);
	return max;
};

const sessionOptionsOf = (spec: AgentSpec): SessionOptions => ({
	...(spec.systemPrompt !== undefined ? { systemPrompt: spec.systemPrompt } : {}),
	...(spec.tools !== undefined ? { tools: spec.tools } : {}),
	...(spec.excludeTools !== undefined ? { excludeTools: spec.excludeTools } : {}),
	...(spec.model !== undefined ? { model: spec.model } : {}),
	...(spec.thinkingLevel !== undefined ? { thinkingLevel: spec.thinkingLevel } : {}),
	...(spec.contextFiles !== undefined ? { contextFiles: spec.contextFiles } : {}),
	...(spec.skills !== undefined ? { skills: spec.skills } : {}),
	...(spec.extensions !== undefined ? { extensions: spec.extensions } : {}),
});

const progressOf = (details: DelegationRunDetails): AgentProgress => ({
	status: details.status,
	...(details.model !== undefined ? { model: details.model } : {}),
	usage: details.usage,
	durationMs: details.durationMs,
	...(details.activity !== undefined ? { activity: details.activity } : {}),
});

const resultOf = (outcome: RunOutcome): AgentResult => ({
	status: outcome.status,
	...(outcome.details.model !== undefined ? { model: outcome.details.model } : {}),
	usage: outcome.details.usage,
	durationMs: outcome.details.durationMs,
	...(outcome.finalText !== undefined ? { finalText: outcome.finalText } : {}),
	...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
});

const failedResult = (error: unknown): AgentResult => ({
	status: "error",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0, contextTokens: 0 },
	durationMs: 0,
	errorMessage: errorMessage(error),
});

export const createAgents = ({
	name,
	backend,
	generation,
	log,
}: {
	name: string;
	backend: AgentBackend;
	generation: Generation;
	log: (message: string) => void;
}): TrAgents => {
	const live = new Map<string, AgentHandle>();
	const listeners = new Set<(event: AgentEvent) => void>();
	const launching = new Set<Promise<unknown>>();

	const deliver = (fns: Iterable<(event: AgentEvent) => void>, event: AgentEvent) => {
		for (const fn of fns) {
			try {
				fn(event);
			} catch (error) {
				log(`agents.onEvent: ${errorMessage(error)}`);
			}
		}
	};

	generation.addDisposer(async () => {
		listeners.clear();
		await Promise.allSettled(launching);
		await Promise.all([...live.values()].map((handle) => handle.cancel()));
	});

	const start = (child: ChildHandle, spec: AgentSpec, signal: AbortSignal | undefined) => {
		const own = new Set<(event: AgentEvent) => void>();
		const controller = new AbortController();
		const base = {
			agentId: child.sessionId,
			parentSessionId: child.record.parentSessionId,
			...(spec.role !== undefined ? { role: spec.role } : {}),
		};
		let status: AgentStatus = "queued";
		let progress: AgentProgress | undefined;
		const emit = (event: AgentEvent) => {
			deliver(own, event);
			deliver(listeners, event);
		};
		const cancel = () => controller.abort();
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();

		emit({ ...base, type: "queued" });
		const result = child
			.runQueued(spec.task, {
				signal: controller.signal,
				...(spec.maxTurns !== undefined ? { maxTurns: spec.maxTurns } : {}),
				onUpdate: (details) => {
					if (status === "queued" && details.status === "running") {
						status = "running";
						emit({ ...base, type: "started" });
					}
					progress = progressOf(details);
					emit({ ...base, type: "progress", progress });
				},
			})
			.then(resultOf, failedResult)
			.then(async (settled) => {
				signal?.removeEventListener("abort", cancel);
				status = settled.status;
				live.delete(base.agentId);
				await child
					.dispose()
					.catch((error: unknown) => log(`agent dispose: ${errorMessage(error)}`));
				emit({ ...base, type: "settled", result: settled });
				own.clear();
				return settled;
			});

		const handle: AgentHandle = {
			id: base.agentId,
			parentSessionId: base.parentSessionId,
			get status() {
				return status;
			},
			get progress() {
				return progress;
			},
			result,
			cancel: () => {
				cancel();
				return result;
			},
			onEvent: (fn) => {
				own.add(fn);
				return () => {
					own.delete(fn);
				};
			},
		};
		live.set(handle.id, handle);
		return handle;
	};

	const spawn = async (spec: AgentSpec, options: AgentSpawnOptions) => {
		if (generation.phase !== "active")
			throw new Error(
				"tr.agents.spawn: the extension is not live (call it from a tool, action, or event)",
			);
		if (typeof spec.task !== "string" || spec.task.trim() === "")
			throw new Error("tr.agents.spawn: task must be a non-empty string");
		const max = concurrencyOf(options.maxConcurrent);
		const parentSessionId = parentIdOf(options.parent);
		const service = backend.serviceFor(parentSessionId);
		if (!service)
			throw new Error(
				`tr.agents.spawn: parent session ${parentSessionId} is not live; pass a live top-level session id or the tool's ctx`,
			);
		const creating = service.createChild({
			parent: parentSessionId,
			info: {
				createdBy: `ext:${name}`,
				...(spec.role !== undefined ? { roleName: spec.role } : {}),
			},
			visibility: "hidden",
			session: sessionOptionsOf(spec),
			concurrency: { pool: `ext:${name}`, max },
		});
		const launch = creating.then(async (child) => {
			if (generation.phase === "active") return start(child, spec, options.signal);
			await child.dispose();
			throw new Error("tr.agents.spawn: the extension was disposed while the agent was starting");
		});
		launching.add(launch);
		return launch.finally(() => launching.delete(launch));
	};

	return {
		spawn,
		run: async (spec, options) => (await spawn(spec, options)).result,
		list: () => [...live.values()],
		onEvent: (fn) => {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
			};
		},
	};
};
