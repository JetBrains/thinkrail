import { randomUUID } from "node:crypto";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { boundedError, OutputTail } from "./output";
import { shellEnvironment } from "./shell-context";
import type {
	BackgroundCommandCompletionBinding,
	BackgroundCommandHandle,
	BackgroundCommandSnapshot,
	BackgroundCommandStart,
	BackgroundCommands,
	BackgroundCommandsBinding,
	BackgroundCommandsOptions,
} from "./types";

function validateStart(input: BackgroundCommandStart): void {
	if (!input.command.trim() || Buffer.byteLength(input.command, "utf8") > 64 * 1024) {
		throw new Error("Command must be nonempty and at most 64 KiB");
	}
	if (input.name !== undefined && [...input.name].length > 200) {
		throw new Error("Display name must be at most 200 characters");
	}
	if (
		input.timeout !== undefined &&
		(!Number.isFinite(input.timeout) || input.timeout <= 0 || input.timeout > 2147483.647)
	) {
		throw new Error("Timeout must be finite, positive seconds, at most 2147483.647");
	}
}

export function createBackgroundCommands(
	binding: BackgroundCommandsBinding,
	options: BackgroundCommandsOptions = {},
): BackgroundCommands {
	const sessionId = binding.sessionId;
	if (!sessionId) throw new Error("A session identity is required");
	const records = new Map<
		string,
		{
			handle: BackgroundCommandHandle;
			output: OutputTail;
			settlement: Promise<void>;
			pending: boolean;
		}
	>();
	const finished: string[] = [];
	const listeners = new Set<() => void>();
	let completionBinding: BackgroundCommandCompletionBinding | undefined;
	let disposed = false;
	let disposal: Promise<void> | undefined;
	let flushing = false;

	const changed = () => {
		for (const listener of [...listeners]) {
			try {
				listener();
			} catch {}
		}
	};
	const flushCompletions = () => {
		if (flushing || disposed) return;
		flushing = true;
		try {
			for (const record of records.values()) {
				const target = completionBinding;
				if (disposed || !target || !record.pending) continue;
				try {
					if (
						binding.canDeliverCompletion?.() === false ||
						target.canDeliverCompletion?.() === false
					)
						continue;
					const output = record.handle.output;
					if (!output || disposed || completionBinding !== target) continue;
					record.pending = false;
					target.deliver({ snapshot: record.handle.snapshot, output });
				} catch {
					record.pending = true;
				}
			}
		} finally {
			flushing = false;
		}
	};

	return {
		sessionId,
		start(input) {
			if (disposed) throw new Error("Background commands service is disposed");
			validateStart(input);
			if (
				[...records.values()].filter((r) => r.handle.snapshot.finishedAt === undefined).length >= 8
			) {
				throw new Error("At most 8 background commands may be active in this session");
			}
			const id = randomUUID();
			const controller = new AbortController();
			const command = input.command;
			const timeout = input.timeout;
			let snapshot: BackgroundCommandSnapshot = {
				id,
				sessionId,
				command,
				name: input.name ?? [...command].slice(0, 200).join(""),
				status: "running",
				startedAt: Date.now(),
			};
			const output = new OutputTail();
			const handle: BackgroundCommandHandle = {
				id,
				get snapshot() {
					return { ...snapshot };
				},
				get output() {
					return output.snapshot;
				},
				stop() {
					if (snapshot.status === "running") {
						snapshot = { ...snapshot, status: "stopping" };
						controller.abort();
						changed();
					}
					return handle.snapshot;
				},
			};
			let settle = () => {};
			const settlement = new Promise<void>((resolve) => {
				settle = resolve;
			});
			const record = { handle, output, pending: false, settlement };
			records.set(id, record);
			changed();
			const execute = async () => {
				try {
					controller.signal.throwIfAborted();
					const context = binding.getContext();
					controller.signal.throwIfAborted();
					const operations = (options.createOperations ?? createLocalBashOperations)(
						context.shellPath ? { shellPath: context.shellPath } : {},
					);
					const resolvedCommand = context.commandPrefix
						? `${context.commandPrefix}\n${command}`
						: command;
					const { exitCode } = await operations.exec(resolvedCommand, context.cwd, {
						env: shellEnvironment(sessionId, context),
						onData: (data) => output.append(data),
						signal: controller.signal,
						...(timeout === undefined ? {} : { timeout }),
					});
					snapshot = {
						...snapshot,
						exitCode,
						status: controller.signal.aborted ? "stopped" : exitCode === 0 ? "completed" : "error",
					};
					if (snapshot.status === "error") {
						snapshot = {
							...snapshot,
							errorMessage:
								exitCode === null
									? "Command ended without an exit code"
									: `Command exited with code ${exitCode}`,
						};
					}
				} catch (error) {
					snapshot = controller.signal.aborted
						? { ...snapshot, status: "stopped" }
						: { ...snapshot, status: "error", errorMessage: boundedError(error) };
				}
				output.finish();
				snapshot = { ...snapshot, finishedAt: Date.now() };
				record.pending = !disposed;
				finished.push(id);
				while (finished.length > 20) {
					const evicted = finished.shift();
					if (evicted === undefined) break;
					records.get(evicted)?.output.clear();
					records.delete(evicted);
				}
				changed();
				flushCompletions();
				settle();
			};
			void execute();
			return handle;
		},
		list: () => [...records.values()].map((record) => record.handle.snapshot),
		find: (id) => records.get(id)?.handle,
		onChange(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		bindCompletion(target) {
			const current: BackgroundCommandCompletionBinding = {
				deliver: (completion) => target.deliver(completion),
				canDeliverCompletion: () => target.canDeliverCompletion?.() !== false,
			};
			completionBinding = disposed ? undefined : current;
			flushCompletions();
			return () => {
				if (completionBinding === current) completionBinding = undefined;
			};
		},
		flushCompletions,
		dispose(disposeOptions) {
			if (disposal) return disposal;
			const timeoutMs = disposeOptions?.timeoutMs ?? 5000;
			if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 2147483647)
				throw new Error("Invalid disposal timeout");
			disposed = true;
			completionBinding = undefined;
			let resolveDisposal = () => {};
			disposal = new Promise<void>((resolve) => {
				resolveDisposal = resolve;
			});
			const captured = [...records.values()];
			for (const record of captured) record.handle.stop();
			const timer = setTimeout(resolveDisposal, timeoutMs);
			void Promise.all(captured.map((record) => record.settlement)).then(() => {
				clearTimeout(timer);
				resolveDisposal();
			});
			return disposal;
		},
	};
}
