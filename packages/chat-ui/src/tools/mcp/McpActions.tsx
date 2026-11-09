import { RiFileTextLine, RiLoginBoxLine, RiSettings3Line } from "@remixicon/react";
import type { McpReadOutputResult } from "@thinkrail/contracts";
import { t as translate, useT } from "@thinkrail/locales/react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@thinkrail/ui/dialog";
import { useState } from "react";
import { type ChatActions, useChatActions } from "../../ChatActions";
import {
	type McpCliAction,
	mcpCliAction,
	mcpFullOutputPath,
	stripMcpCliInstruction,
} from "./mcpResult";

const ACTION_CLASS =
	"flex items-center gap-4 rounded-xs text-primary tr-text-metadata outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary";

function actionHandler(actions: ChatActions | null, action: McpCliAction | null) {
	return action === "provider-sign-in"
		? actions?.openProviderSettings
		: action
			? actions?.openMcpSettings
			: undefined;
}

function CliActionButton({ action, onOpen }: { action: McpCliAction; onOpen: () => void }) {
	const t = useT();
	return (
		<button
			type="button"
			data-testid="mcp-cli-action"
			data-action={action}
			onClick={onOpen}
			className={ACTION_CLASS}
		>
			{action !== "settings" ? (
				<RiLoginBoxLine className="size-12 shrink-0" />
			) : (
				<RiSettings3Line className="size-12 shrink-0" />
			)}
			{action === "provider-sign-in"
				? t("mcp.card.signInProvider")
				: action === "sign-in"
					? t("mcp.card.signIn")
					: t("mcp.card.openSettings")}
		</button>
	);
}

export function McpCliActionButton({ text }: { text: string }) {
	const actions = useChatActions();
	const action = mcpCliAction(text);
	const openSettings = actionHandler(actions, action);
	return action && openSettings ? <CliActionButton action={action} onOpen={openSettings} /> : null;
}

/** A failure's text as the card shows it: pi's CLI instruction is dropped once the button replaces it. */
export function useMcpFailureText(text: string, failed: boolean): string {
	const actions = useChatActions();
	return failed && actionHandler(actions, mcpCliAction(text)) ? stripMcpCliInstruction(text) : text;
}

type McpFullOutputState =
	| { kind: "loading" }
	| { kind: "loaded"; result: McpReadOutputResult }
	| { kind: "failed"; message: string };

export function McpFullOutputBody({
	state,
	onRetry,
}: {
	state: McpFullOutputState;
	onRetry: () => void;
}) {
	const t = useT();
	if (state.kind === "loading") {
		return <p className="text-text-muted tr-text-metadata">{t("mcp.fullOutput.loading")}</p>;
	}
	if (state.kind === "failed") {
		return (
			<p role="alert" className="flex flex-wrap items-center gap-8 text-feedback-error tr-text-ui">
				<span className="break-words">{state.message}</span>
				<button
					type="button"
					data-testid="mcp-full-output-retry"
					onClick={onRetry}
					className={ACTION_CLASS}
				>
					{t("mcp.fullOutput.retry")}
				</button>
			</p>
		);
	}
	const { result } = state;
	if (!result.available) {
		return (
			<div
				data-testid="mcp-full-output-unavailable"
				data-reason={result.reason}
				className="flex flex-col gap-4"
			>
				<p className="text-text-default tr-text-ui">
					{result.reason === "expired" ? t("mcp.fullOutput.expired") : t("mcp.fullOutput.none")}
				</p>
				{result.reason === "expired" ? (
					<p className="text-text-muted tr-text-metadata">{t("mcp.fullOutput.expiredDetail")}</p>
				) : null}
			</div>
		);
	}
	return (
		<>
			{result.truncated ? (
				<p data-testid="mcp-full-output-truncated" className="text-text-muted tr-text-metadata">
					{t("mcp.fullOutput.truncated")}
				</p>
			) : null}
			<pre
				data-testid="mcp-full-output-text"
				className="min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-container-content-bg p-8 tr-code-text text-text-default"
			>
				{result.text}
			</pre>
		</>
	);
}

function failureMessage(error: unknown): string {
	return error instanceof Error && error.message
		? error.message
		: translate("mcp.fullOutput.readFailed");
}

function McpFullOutput({
	toolCallId,
	title,
	readOutput,
}: {
	toolCallId: string;
	title: string;
	readOutput: (toolCallId: string) => Promise<McpReadOutputResult>;
}) {
	const t = useT();
	const [state, setState] = useState<McpFullOutputState | null>(null);
	const load = () => {
		setState({ kind: "loading" });
		readOutput(toolCallId).then(
			(result) => setState({ kind: "loaded", result }),
			(error: unknown) => setState({ kind: "failed", message: failureMessage(error) }),
		);
	};
	return (
		<Dialog
			onOpenChange={(open) => {
				if (open && (state === null || state.kind === "failed")) load();
			}}
		>
			<DialogTrigger asChild>
				<button type="button" data-testid="mcp-full-output" className={ACTION_CLASS}>
					<RiFileTextLine className="size-12 shrink-0" />
					{t("mcp.fullOutput.title")}
				</button>
			</DialogTrigger>
			<DialogContent data-testid="mcp-full-output-dialog" className="max-h-[85vh] max-w-3xl">
				<DialogHeader className="pr-24">
					<DialogTitle>{t("mcp.fullOutput.title")}</DialogTitle>
					<DialogDescription className="truncate">{title}</DialogDescription>
				</DialogHeader>
				<McpFullOutputBody state={state ?? { kind: "loading" }} onRetry={load} />
			</DialogContent>
		</Dialog>
	);
}

export function McpActions({
	toolCallId,
	title,
	result,
	failureText,
}: {
	toolCallId: string;
	title: string;
	result: unknown;
	failureText: string;
}) {
	const actions = useChatActions();
	const readOutput = actions?.readMcpOutput;
	const fullOutput = readOutput && mcpFullOutputPath(result) !== null ? readOutput : null;
	const cli = failureText ? mcpCliAction(failureText) : null;
	const openSettings = actionHandler(actions, cli);
	if (!fullOutput && !(cli && openSettings)) return null;
	return (
		<div className="flex flex-wrap items-center gap-x-12 gap-y-4">
			{cli && openSettings ? <CliActionButton action={cli} onOpen={openSettings} /> : null}
			{fullOutput ? (
				<McpFullOutput toolCallId={toolCallId} title={title} readOutput={fullOutput} />
			) : null}
		</div>
	);
}
