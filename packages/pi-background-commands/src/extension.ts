import type {
	ExtensionContext,
	ExtensionFactory,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { tail } from "./output";
import { createBackgroundCommands } from "./service";
import { standaloneContext } from "./shell-context";
import type {
	BackgroundCommandCompletion,
	BackgroundCommandFlush,
	BackgroundCommandSnapshot,
	BackgroundCommands,
} from "./types";

export const BACKGROUND_COMMAND_COMPLETION_MESSAGE = "background-command-completion";

export type CompletionDelivery = "wake" | "run" | "appended";

type DeliveryMode = { idle: true } | { idle: false; runContinues: boolean; viaHost: boolean };

export interface BackgroundCommandsExtensionOptions {
	service?: BackgroundCommands;
	canDeliverCompletion?(): boolean;
}

export type BackgroundCommandInput =
	| { action: "start"; command: string; name?: string; timeout?: number }
	| { action: "list" }
	| { action: "output" | "stop"; id: string };

const parameters = Type.Object(
	{
		action: Type.Enum(["start", "list", "output", "stop"], { type: "string" }),
		command: Type.Optional(
			Type.String({
				description: "Foreground shell command, for start only",
				minLength: 1,
				maxLength: 65536,
			}),
		),
		name: Type.Optional(
			Type.String({ description: "Display name, for start only", maxLength: 200 }),
		),
		timeout: Type.Optional(
			Type.Number({
				description: "Timeout in seconds, for start only; no default",
				exclusiveMinimum: 0,
				maximum: 2147483.647,
			}),
		),
		id: Type.Optional(
			Type.String({ description: "Opaque command id returned by start, for output or stop only" }),
		),
	},
	{ additionalProperties: false },
);

function assertInput(input: unknown): asserts input is BackgroundCommandInput {
	if (!input || typeof input !== "object" || !("action" in input))
		throw new Error("A background command action is required");
	let allowed: string[];
	switch (input.action) {
		case "start":
			allowed = ["action", "command", "name", "timeout"];
			if (!("command" in input) || typeof input.command !== "string")
				throw new Error("start requires command");
			if ("name" in input && typeof input.name !== "string")
				throw new Error("name must be a string");
			if ("timeout" in input && typeof input.timeout !== "number")
				throw new Error("timeout must be seconds");
			break;
		case "list":
			allowed = ["action"];
			break;
		case "output":
		case "stop":
			allowed = ["action", "id"];
			if (!("id" in input) || typeof input.id !== "string" || !input.id)
				throw new Error("output and stop require a command id");
			break;
		default:
			throw new Error("Unknown background command action");
	}
	if (Object.keys(input).some((key) => !allowed.includes(key)))
		throw new Error("Unsupported inputs for this background command action");
}

function summary(snapshot: BackgroundCommandSnapshot) {
	const { command: _command, ...result } = snapshot;
	return result;
}

function statusText(snapshot: BackgroundCommandSnapshot): string {
	return `${snapshot.id} (${snapshot.name}): ${snapshot.status}`;
}

function terminalText(snapshot: BackgroundCommandSnapshot): string {
	const exit =
		snapshot.exitCode === undefined || snapshot.exitCode === null
			? ""
			: `, exit code ${snapshot.exitCode}`;
	return `${statusText(snapshot)}${exit}${snapshot.errorMessage ? `\n${snapshot.errorMessage}` : ""}`;
}

const heldAtStopByService = new WeakMap<BackgroundCommands, Set<string>>();

function heldAtStopFor(service: BackgroundCommands): Set<string> {
	let held = heldAtStopByService.get(service);
	if (!held) {
		held = new Set();
		heldAtStopByService.set(service, held);
	}
	return held;
}

function deliveryOf(mode: DeliveryMode, batchWakes: boolean, index: number): CompletionDelivery {
	if (mode.idle) return !batchWakes ? "appended" : index === 0 ? "wake" : "run";
	return mode.runContinues || batchWakes ? "run" : "appended";
}

function eligibleTurn(
	event: TurnEndEvent,
	ctx: ExtensionContext,
): { runContinues: boolean } | undefined {
	const stopReason = event.message.role === "assistant" ? event.message.stopReason : undefined;
	if ((stopReason !== "stop" && stopReason !== "toolUse") || ctx.signal?.aborted === true)
		return undefined;
	return { runContinues: stopReason === "toolUse" };
}

export function createBackgroundCommandsExtension(
	options: BackgroundCommandsExtensionOptions = {},
): ExtensionFactory {
	return (pi) => {
		let service = options.service;
		let latestContext: ExtensionContext | undefined;
		let sessionContext: ExtensionContext | undefined;
		let shuttingDown = false;
		let unbind: (() => void) | undefined;
		let turnEnd: { runContinues: boolean } | undefined;
		let boundary: { runContinues: boolean; wake: boolean } | undefined;
		let owedWake = false;
		let flushScheduled = false;

		const parentIdle = () => {
			try {
				return sessionContext?.isIdle() ?? false;
			} catch {
				return false;
			}
		};
		const modeFor = (flush: BackgroundCommandFlush): DeliveryMode | undefined => {
			if (boundary) return { idle: false, runContinues: boundary.runContinues, viaHost: false };
			if (parentIdle()) return flushScheduled ? undefined : { idle: true };
			if (flush.atTurnEnd && turnEnd) return { idle: false, ...turnEnd, viaHost: true };
			return undefined;
		};
		const wakes = ({ snapshot }: BackgroundCommandCompletion) =>
			snapshot.status !== "stopped" && !(service && heldAtStopFor(service).has(snapshot.id));
		const flushAtBoundary = (runContinues: boolean) => {
			boundary = { runContinues, wake: false };
			try {
				service?.flushCompletions();
				return boundary.wake;
			} finally {
				boundary = undefined;
			}
		};
		const scheduleFlush = () => {
			if (flushScheduled || shuttingDown) return;
			flushScheduled = true;
			setTimeout(() => {
				flushScheduled = false;
				service?.flushCompletions();
			}, 0);
		};

		pi.on("turn_end", (event, ctx) => {
			turnEnd = eligibleTurn(event, ctx);
			if (turnEnd && flushAtBoundary(turnEnd.runContinues)) return { continue: true };
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
			const owed = owedWake;
			owedWake = false;
			return flushAtBoundary(owed) || owed ? { continue: true } : undefined;
		});
		pi.on("agent_settled", (event) => {
			turnEnd = undefined;
			owedWake = false;
			if (event.aborted && service) {
				const held = heldAtStopFor(service);
				for (const snapshot of service.list()) {
					if (snapshot.finishedAt !== undefined) held.add(snapshot.id);
				}
				for (const id of held) if (!service.find(id)) held.delete(id);
			}
			scheduleFlush();
		});
		pi.on("before_agent_start", (event) => {
			if (event.messageType === "user" && service) heldAtStopFor(service).clear();
		});
		pi.on("session_compact", () => scheduleFlush());
		pi.on("session_compact_failed", () => scheduleFlush());
		pi.on("session_tree", () => scheduleFlush());

		pi.on("session_start", (_event, ctx) => {
			latestContext = ctx;
			sessionContext = ctx;
			shuttingDown = false;
			service ??= createBackgroundCommands({
				sessionId: ctx.sessionManager.getSessionId(),
				getContext() {
					if (!latestContext) throw new Error("Session context is unavailable");
					return standaloneContext(latestContext);
				},
			});
			if (service.sessionId !== ctx.sessionManager.getSessionId())
				throw new Error("Background commands belong to a different session");
			pi.registerTool({
				name: "background_command",
				label: "Background command",
				description:
					"Explicitly start a noninteractive background command, list this session's commands, read output, or stop one command by id. Output is a replacement snapshot of the last 2000 lines / 50 KiB, not an archive. Only start accepts command, name and timeout (seconds). At most 8 commands may be active; the latest 20 finished records are retained. Stop requests cancellation; stopping is not yet terminal.",
				promptSnippet: "Start, inspect, and stop session-owned background commands",
				promptGuidelines: [
					"Use background_command only for explicitly background work; ordinary bash behavior is unchanged.",
					"Keep background_command shell commands foreground: do not detach with &, nohup, disown, daemonization, or similar escapes. Managed commands have no stdin or PTY.",
					"A finished background_command is reported to you automatically, before your next step while you work or as a new turn when you are idle; do not poll or sleep to wait, end your turn instead. Use output when recent logs are needed. Stop cancels without waking the parent.",
				],
				parameters,
				async execute(_toolCallId, params, _signal, _onUpdate, currentContext) {
					if (shuttingDown || !service)
						throw new Error("Background commands session is shutting down");
					if (currentContext.sessionManager.getSessionId() !== service.sessionId)
						throw new Error("Background commands belong to a different session");
					latestContext = currentContext;
					assertInput(params);
					if (params.action === "start") {
						const handle = service.start(params);
						return {
							content: [
								{
									type: "text",
									text: `Accepted background command ${statusText(handle.snapshot)}`,
								},
							],
							details: { snapshot: handle.snapshot },
						};
					}
					if (params.action === "list") {
						const snapshots = service.list();
						return {
							content: [
								{
									type: "text",
									text:
										snapshots.map(statusText).join("\n") ||
										"No background commands in this session.",
								},
							],
							details: { commands: snapshots.map(summary) },
						};
					}
					const handle = service.find(params.id);
					if (!handle)
						throw new Error(
							"Background command unavailable in this session (unknown, evicted, or lost on host restart)",
						);
					if (params.action === "stop") {
						const snapshot = handle.stop();
						return {
							content: [{ type: "text", text: `Stop requested; ${statusText(snapshot)}` }],
							details: { snapshot },
						};
					}
					const output = handle.output;
					if (!output) throw new Error("Background command output unavailable");
					const snapshot = handle.snapshot;
					const finished = snapshot.finishedAt !== undefined;
					if (finished) handle.claimCompletion();
					return {
						content: [
							{
								type: "text",
								text: `${finished ? terminalText(snapshot) : statusText(snapshot)}\n\n${output.truncated ? "[Output truncated; retained tail only.]\n" : ""}${output.text || "(no output)"}`,
							},
						],
						details: { snapshot, output },
					};
				},
			});

			unbind?.();
			unbind = service.bindCompletion({
				canDeliverCompletion: (flush) =>
					!shuttingDown &&
					options.canDeliverCompletion?.() !== false &&
					modeFor(flush) !== undefined,
				deliver(batch, flush) {
					const mode = modeFor(flush);
					if (!mode) return [];
					const batchWakes = batch.some(wakes);
					const carrier = mode.idle ? batch.findLast(wakes) : undefined;
					const ordered = carrier ? [...batch.filter((c) => c !== carrier), carrier] : batch;
					const accepted: BackgroundCommandCompletion[] = [];
					for (const [index, completion] of ordered.entries()) {
						const { snapshot, output } = completion;
						const excerpt = tail(output.text, 4096, 40);
						const truncated = output.truncated || excerpt.truncated;
						const status = snapshot.status === "stopped" ? "Cancelled" : "Finished";
						const diagnostic = snapshot.errorMessage ? `\n${snapshot.errorMessage}` : "";
						try {
							pi.sendMessage(
								{
									customType: BACKGROUND_COMMAND_COMPLETION_MESSAGE,
									display: true,
									content: `${status} background command ${statusText(snapshot)}${diagnostic}\n\n${excerpt.text || "(no output)"}${truncated ? "\n[Excerpt truncated; use background_command output for the retained tail.]" : ""}`,
									details: {
										...summary(snapshot),
										output: { text: excerpt.text, truncated },
										delivery: deliveryOf(mode, batchWakes, index),
									},
								},
								{ triggerTurn: completion === carrier },
							);
						} catch {
							break;
						}
						accepted.push(completion);
					}
					if (!mode.idle && accepted.some(wakes)) {
						if (mode.viaHost) owedWake = true;
						else if (boundary) boundary.wake = true;
					}
					return accepted;
				},
			});
		});

		pi.on("session_shutdown", async () => {
			shuttingDown = true;
			unbind?.();
			unbind = undefined;
			if (!options.service) {
				await service?.dispose();
				service = undefined;
			}
			latestContext = undefined;
		});
	};
}
