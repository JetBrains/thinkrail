import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	type ChildHandle,
	createDelegationService,
	DEFAULT_SCOPE,
	type DelegationRunDetails,
	type DelegationService,
	defaultDelegationRoot,
	deriveChildSessionFile,
	type RunOutcome,
	type RunSnapshot,
	type RunStatus,
} from "pi-delegation";
import { Type } from "typebox";
import { type AgentDefinition, discoverAgentDefinitions } from "./definitions";
import { RECURSION_GUARD_TOOLS, toSpawnMapping } from "./mapping";
import { THINKING_LEVELS } from "./thinking";

export const SUBAGENT_COMPLETION_MESSAGE = "subagent-completion";

export type CompletionDelivery = "wake" | "run" | "appended";

export type SubagentCompletionDetails = DelegationRunDetails & { delivery?: CompletionDelivery };

const MAX_RESULT_CHARS = 50_000;

export interface SubagentsExtensionOptions {
	service?: DelegationService;
	delegationRoot?: string;
	scope?: string;
	isEnabled?: () => boolean;
	canDeliverCompletion?: () => boolean;
}

export interface Subagents {
	extension: ExtensionFactory;
	flushCompletions(options?: { atTurnEnd?: boolean }): void;
	dispose(): void;
}

function discoverFor(ctx: ExtensionContext): AgentDefinition[] {
	return discoverAgentDefinitions({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		includeProject: ctx.isProjectTrusted(),
	});
}

function agentListLines(definitions: AgentDefinition[]): string {
	return definitions
		.map((d) => {
			const model = d.model === undefined ? "call or parent" : `pinned ${d.model}`;
			const thinking =
				d.thinking === undefined ? "" : `; thinking: ${d.thinking} (overrides suffix)`;
			const tools = d.tools?.join(", ") ?? "pi defaults: read, bash, edit, write";
			return `- "${d.name}" (${d.source}): ${d.description} [model: ${model}${thinking}; tools: ${tools}]`;
		})
		.join("\n");
}

export function boundedText(run: {
	status: RunStatus;
	finalText?: string | undefined;
	errorMessage?: string | undefined;
}): string {
	const text =
		run.status === "error"
			? `${run.errorMessage ?? "unknown error"}${run.finalText ? `\n\n${run.finalText}` : ""}`
			: (run.finalText ?? (run.status === "completed" ? "(no output)" : `Run ${run.status}.`));
	return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : text;
}

function pulledReport(snapshot: RunSnapshot & { status: RunStatus }): string {
	const report = boundedText(snapshot);
	if (snapshot.status === "error") return `Run error: ${report}`;
	if (snapshot.status !== "aborted") return report;
	const reason = snapshot.details.abortReason ? ` (${snapshot.details.abortReason})` : "";
	return snapshot.finalText ? `Run aborted${reason}:\n\n${report}` : `Run aborted${reason}.`;
}

export function createSubagentsExtension(
	options: SubagentsExtensionOptions = {},
): ExtensionFactory {
	return (pi) => createOwner(options, false).extension(pi);
}

export function createSubagents(
	options: SubagentsExtensionOptions & { service: DelegationService },
): Subagents {
	return createOwner(options, true);
}

interface HeldCompletion {
	outcome: RunOutcome;
	roleName: string;
	child: ChildHandle;
	stopped: boolean;
}

type DeliveryMode = { idle: true } | { idle: false; runContinues: boolean };

function wakes(completion: HeldCompletion): boolean {
	return !completion.stopped && completion.outcome.details.abortReason !== "user";
}

function deliveryOf(mode: DeliveryMode, batchWakes: boolean, index: number): CompletionDelivery {
	if (mode.idle) return !batchWakes ? "appended" : index === 0 ? "wake" : "run";
	return mode.runContinues || batchWakes ? "run" : "appended";
}

function eligibleTurn(event: TurnEndEvent, ctx: ExtensionContext): boolean {
	const stopReason = event.message.role === "assistant" ? event.message.stopReason : undefined;
	return (stopReason === "stop" || stopReason === "toolUse") && ctx.signal?.aborted !== true;
}

function createOwner(options: SubagentsExtensionOptions, retained: boolean): Subagents {
	let parentSessionId: string | undefined;
	let sender: { send: ExtensionAPI["sendMessage"]; isIdle: () => boolean } | undefined;
	let closed = false;
	let flushing = false;
	let flushScheduled = false;
	let turnEnd: { runContinues: boolean } | undefined;
	let owedWake = false;
	const pending = new Set<HeldCompletion>();

	function dispose(): void {
		closed = true;
		sender = undefined;
		pending.clear();
	}

	function parentIdle(): boolean {
		try {
			return sender?.isIdle() ?? false;
		} catch {
			return false;
		}
	}

	function deliver(mode: DeliveryMode): boolean {
		if (flushing || closed || !sender || !(options.canDeliverCompletion?.() ?? true)) return false;
		flushing = true;
		try {
			for (const completion of pending) {
				if (completion.child.snapshot?.collected) pending.delete(completion);
			}
			const batch = [...pending];
			const batchWakes = batch.some(wakes);
			const carrier = mode.idle ? batch.findLast(wakes) : undefined;
			const ordered = carrier ? [...batch.filter((c) => c !== carrier), carrier] : batch;
			let deliveredWake = false;
			for (const [index, completion] of ordered.entries()) {
				if (closed || !sender) break;
				const delivery = deliveryOf(mode, batchWakes, index);
				const { outcome, roleName, child } = completion;
				pending.delete(completion);
				try {
					sender.send(
						{
							customType: SUBAGENT_COMPLETION_MESSAGE,
							content: `Subagent "${roleName}" (${child.sessionId}) ${outcome.status}:\n\n${boundedText(outcome)}`,
							display: true,
							details: { ...outcome.details, delivery } satisfies SubagentCompletionDetails,
						},
						{ triggerTurn: completion === carrier },
					);
					deliveredWake ||= wakes(completion);
				} catch {
					if (!closed) pending.add(completion);
					break;
				}
			}
			return deliveredWake;
		} finally {
			flushing = false;
		}
	}

	function flushCompletions(flush: { atTurnEnd?: boolean } = {}): void {
		if (closed) return;
		if (parentIdle()) {
			if (!flushScheduled) deliver({ idle: true });
			return;
		}
		if (flush.atTurnEnd && turnEnd && deliver({ idle: false, ...turnEnd })) owedWake = true;
	}

	function scheduleFlush(): void {
		if (closed || flushScheduled) return;
		flushScheduled = true;
		setTimeout(() => {
			flushScheduled = false;
			flushCompletions();
		}, 0);
	}

	const extension: ExtensionFactory = (pi) => {
		const binding = { send: pi.sendMessage, isIdle: () => false };
		const delegationRoot = options.delegationRoot ?? defaultDelegationRoot();
		const scope = options.scope ?? DEFAULT_SCOPE;
		const isEnabled = () => !closed && (options.isEnabled?.() ?? true);
		const erroredRunDetails = new Map<string, DelegationRunDetails>();
		pi.on("tool_result", (event) => {
			const details = erroredRunDetails.get(event.toolCallId);
			if (details === undefined) return undefined;
			erroredRunDetails.delete(event.toolCallId);
			return event.isError ? { details } : undefined;
		});
		pi.on("turn_end", (event, ctx) => {
			erroredRunDetails.clear();
			registerAgentTool(ctx);
			const runContinues =
				event.message.role === "assistant" && event.message.stopReason === "toolUse";
			turnEnd = eligibleTurn(event, ctx) ? { runContinues } : undefined;
			if (turnEnd && deliver({ idle: false, ...turnEnd })) return { continue: true };
			return undefined;
		});
		pi.on("turn_start", () => {
			turnEnd = undefined;
			owedWake = false;
		});
		pi.on("agent_end", () => {
			turnEnd = undefined;
		});
		pi.on("agent_before_settle", () => {
			const wake = deliver({ idle: false, runContinues: owedWake }) || owedWake;
			owedWake = false;
			return wake ? { continue: true } : undefined;
		});
		pi.on("agent_settled", (event) => {
			turnEnd = undefined;
			owedWake = false;
			if (event.aborted) for (const completion of pending) completion.stopped = true;
			scheduleFlush();
		});
		pi.on("session_compact", () => scheduleFlush());
		pi.on("session_compact_failed", () => scheduleFlush());
		pi.on("session_tree", () => scheduleFlush());
		pi.on("session_shutdown", async (event, ctx) => {
			if (sender === binding) sender = undefined;
			if (!retained || event.reason !== "reload") dispose();
			erroredRunDetails.clear();
			const service = fallbackService;
			if (!service) return;
			fallbackService = undefined;
			await service.disposeChildrenOf(ctx.sessionManager.getSessionId());
		});

		let latestCtx: ExtensionContext | undefined;
		let fallbackService: DelegationService | undefined;
		function serviceFor(ctx: ExtensionContext): DelegationService {
			if (closed || parentSessionId !== ctx.sessionManager.getSessionId())
				throw new Error("Subagent session is unavailable");
			latestCtx = ctx;
			if (options.service) return options.service;
			fallbackService ??= createDelegationService({
				resolveParent: (sessionId) =>
					latestCtx && sessionId === latestCtx.sessionManager.getSessionId()
						? latestCtx
						: undefined,
				delegationRoot,
				scope,
			});
			return fallbackService;
		}

		function registerAgentTool(sessionCtx: ExtensionContext): void {
			const definitions = discoverFor(sessionCtx);
			const known = agentListLines(definitions);

			pi.registerTool({
				name: "Agent",
				label: "Agent",
				description: `Delegate a task to a specialized subagent with its own isolated context window.
The subagent works autonomously and non-interactively: give it one complete, self-contained task
(everything it must know goes in the task text) and it returns a final report. Issue several Agent
calls in ONE message to run subagents in parallel; sequence dependent steps yourself across turns.
Set run_in_background for long tasks: you get the session id immediately, and the subagent's report
is delivered to you automatically, before your next step while you work or as a new turn when you
are idle. Do not poll get_subagent_result or sleep to wait; to wait, end your turn. Use
get_subagent_result only to check a run's status or re-read a finished report. Set model to choose
an available model for an unpinned agent; a definition's pinned model always wins, ignoring the
invocation model and its suffix. A model reference with no whole-reference match may end in
:<thinking> (${THINKING_LEVELS.join(", ")}). Whole-reference matches keep their meaning;
ambiguous references fail rather than being reinterpreted. Explicit definition thinking overrides
a suffix; without either, thinking inherits the parent. Pi clamps thinking to model capabilities.
Subagents cannot call MCP tools (mcp__*, tool_search, the MCP resource tools): call those yourself and put what the
subagent needs in the task.

Available subagent types:
${known}`,
				parameters: Type.Object({
					subagent_type: Type.String({
						description: 'The agent definition to run, e.g. "scout"',
					}),
					task: Type.String({
						description: "The complete, self-contained task for the subagent",
					}),
					model: Type.Optional(
						Type.String({
							description:
								'Available model for an unpinned agent: "provider/id" or "provider/id:thinking". Whole-reference matches win; a definition pin ignores this value, and definition thinking overrides a suffix.',
						}),
					),
					run_in_background: Type.Optional(
						Type.Boolean({
							description: "Do not wait: return the child session id immediately",
						}),
					),
				}),
				async execute(toolCallId, params, signal, onUpdate, ctx) {
					if (!isEnabled()) throw new Error("Subagents are disabled in this session.");
					const definition = definitions.find((d) => d.name === params.subagent_type);
					if (!definition) {
						throw new Error(
							`Unknown subagent type "${params.subagent_type}". Available:\n${agentListLines(definitions)}`,
						);
					}
					const service = serviceFor(ctx);
					const mapping = toSpawnMapping(definition, {
						cwd: ctx.cwd,
						availableModels: ctx.modelRegistry.getAvailable(),
						...(params.model !== undefined ? { model: params.model } : {}),
					});
					const child = await service.createChild({
						parent: ctx.sessionManager.getSessionId(),
						visibility: "hidden",
						info: {
							createdBy: "tool:Agent",
							roleName: definition.name,
							roleSource: definition.source,
							...(params.run_in_background ? { detached: true } : {}),
						},
						session: mapping.session,
					});

					if (!isEnabled()) {
						await child.dispose();
						throw new Error("Subagents are disabled in this session.");
					}

					const run = child.runQueued(params.task, {
						...(mapping.maxTurns !== undefined ? { maxTurns: mapping.maxTurns } : {}),
						...(!params.run_in_background && signal !== undefined ? { signal } : {}),
						onUpdate: (details) => {
							onUpdate?.({ content: [{ type: "text", text: details.status }], details });
						},
					});

					if (params.run_in_background) {
						run
							.then((outcome) => {
								if (closed) return;
								pending.add({ outcome, roleName: definition.name, child, stopped: false });
								flushCompletions();
							})
							.catch(() => {});
						const details = child.snapshot?.details;
						if (details === undefined) {
							throw new Error("pi-delegation invariant violated: no run snapshot after runQueued");
						}
						return {
							content: [
								{
									type: "text",
									text: `Started "${definition.name}" in the background: ${child.sessionId}`,
								},
							],
							details,
						};
					}

					const outcome = await run;
					if (outcome.status === "error") {
						erroredRunDetails.set(toolCallId, outcome.details);
						throw new Error(
							`Subagent "${definition.name}" (${child.sessionId}) failed: ${boundedText(outcome)}`,
						);
					}
					return {
						content: [{ type: "text", text: boundedText(outcome) }],
						details: outcome.details,
					};
				},
			});
		}

		pi.on("before_agent_start", (event, ctx) => {
			if (event.messageType === "user")
				for (const completion of pending) completion.stopped = false;
			registerAgentTool(ctx);
		});

		pi.on("session_start", (_event, sessionCtx) => {
			const sessionId = sessionCtx.sessionManager.getSessionId();
			if (parentSessionId !== undefined && parentSessionId !== sessionId)
				throw new Error("Subagents belong to a different session");
			parentSessionId ??= sessionId;
			binding.isIdle = () => sessionCtx.isIdle();
			if (!closed) sender = binding;
			registerAgentTool(sessionCtx);
			pi.registerTool({
				name: "get_subagent_result",
				label: "Get subagent result",
				description:
					"Collect the result or current status of a subagent started with Agent (typically one started with run_in_background).",
				parameters: Type.Object({
					session_id: Type.String({ description: "The child session id returned by Agent" }),
				}),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					const service = serviceFor(ctx);
					const found = service.findChild(params.session_id);
					const child =
						found?.record.parentSessionId === ctx.sessionManager.getSessionId() ? found : undefined;
					if (!child) {
						const transcript = deriveChildSessionFile(
							delegationRoot,
							scope,
							ctx.sessionManager.getSessionId(),
							params.session_id,
						);
						throw new Error(
							`Unknown subagent session ${params.session_id}. If the host restarted, the in-memory run registry was lost${
								transcript
									? `; the transcript survives at ${transcript}`
									: " and no transcript was found for it under this session"
							}.`,
						);
					}
					const snapshot = child.collectResult();
					if (!snapshot) {
						return {
							content: [{ type: "text", text: "The subagent has not been given a task yet." }],
							details: {},
						};
					}
					const status = snapshot.status;
					if (status === "queued" || status === "running") {
						return {
							content: [
								{
									type: "text",
									text: `Still ${status}. Its report is delivered to you automatically when it finishes: continue with other work or end your turn instead of polling.`,
								},
							],
							details: snapshot.details,
						};
					}
					return {
						content: [{ type: "text", text: pulledReport({ ...snapshot, status }) }],
						details: snapshot.details,
					};
				},
			});

			if (!isEnabled()) {
				pi.setActiveTools(
					pi
						.getActiveTools()
						.filter((name) => !RECURSION_GUARD_TOOLS.some((toolName) => toolName === name)),
				);
			}
			flushCompletions();
		});
	};
	return { extension, flushCompletions, dispose };
}
