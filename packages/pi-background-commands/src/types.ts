import type { BashOperations, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type BackgroundCommandStatus = "running" | "stopping" | "completed" | "error" | "stopped";

export interface BackgroundCommandStart {
	command: string;
	name?: string;
	timeout?: number;
}

export interface BackgroundCommandContext {
	cwd: string;
	sessionFile?: string | undefined;
	model?: Pick<NonNullable<ExtensionContext["model"]>, "provider" | "id"> | undefined;
	thinkingLevel?: ExtensionContext["thinkingLevel"];
	shellPath?: string | undefined;
	commandPrefix?: string | undefined;
	exposeSessionEnvironment?: boolean;
}

export interface BackgroundCommandsBinding {
	sessionId: string;
	getContext(): BackgroundCommandContext;
	canDeliverCompletion?(): boolean;
}

export interface BackgroundCommandsOptions {
	createOperations?(options: { shellPath?: string }): BashOperations;
}

export interface BackgroundCommandSnapshot {
	readonly id: string;
	readonly sessionId: string;
	readonly name: string;
	readonly command: string;
	readonly status: BackgroundCommandStatus;
	readonly startedAt: number;
	readonly finishedAt?: number;
	readonly exitCode?: number | null;
	readonly errorMessage?: string;
}

export interface BackgroundCommandOutput {
	readonly text: string;
	readonly truncated: boolean;
}

export interface BackgroundCommandHandle {
	readonly id: string;
	readonly snapshot: BackgroundCommandSnapshot;
	readonly output: BackgroundCommandOutput | undefined;
	stop(): BackgroundCommandSnapshot;
}

export interface BackgroundCommandCompletion {
	readonly snapshot: BackgroundCommandSnapshot;
	readonly output: BackgroundCommandOutput;
}

export interface BackgroundCommandCompletionBinding {
	deliver(completion: BackgroundCommandCompletion): void;
	canDeliverCompletion?(): boolean;
}

export interface BackgroundCommands {
	readonly sessionId: string;
	start(input: BackgroundCommandStart): BackgroundCommandHandle;
	list(): BackgroundCommandSnapshot[];
	find(id: string): BackgroundCommandHandle | undefined;
	onChange(listener: () => void): () => void;
	bindCompletion(binding: BackgroundCommandCompletionBinding): () => void;
	flushCompletions(): void;
	dispose(options?: { timeoutMs?: number }): Promise<void>;
}
