import {
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiRobot2Line,
	RiTerminalBoxLine,
} from "@remixicon/react";
import type { BackgroundCommandSummary, SubagentResourceSummary } from "@thinkrail/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Action = { pending: boolean; error: string | null };

interface Props {
	commands: BackgroundCommandSummary[];
	subagents: SubagentResourceSummary[];
	finishedCommands: BackgroundCommandSummary[];
	finishedSubagents: SubagentResourceSummary[];
	authoritative: boolean;
	loading: boolean;
	stale: boolean;
	error: string | null;
	actions: Record<string, Action>;
	onRetry: () => void;
	onLogs: (command: BackgroundCommandSummary) => void;
	onTranscript: (childSessionId: string) => void;
	onStopCommand: (commandId: string) => void;
	onStopSubagent: (childSessionId: string) => void;
	onStopAll: () => void;
}

function StopAction({
	disabled,
	action,
	onStop,
}: {
	disabled: boolean;
	action: Action | undefined;
	onStop: () => void;
}) {
	return (
		<Button
			variant="ghost"
			size="sm"
			data-testid="resource-stop"
			disabled={disabled || action?.pending}
			onClick={onStop}
		>
			{action?.pending ? "Stopping…" : "Stop"}
		</Button>
	);
}

function ActionError({ action }: { action: Action | undefined }) {
	return action?.error ? (
		<p role="alert" className="break-words text-feedback-error tr-text-metadata">
			{action.error}
		</p>
	) : null;
}

function CommandRow({
	command,
	active,
	props,
}: {
	command: BackgroundCommandSummary;
	active: boolean;
	props: Props;
}) {
	const action = props.actions[`command:${command.id}`];
	return (
		<div
			data-testid="resource-command"
			data-resource-id={command.id}
			data-status={command.status}
			className="flex min-w-0 flex-col gap-4 border-border-muted border-b py-8 last:border-b-0"
		>
			<div className="flex min-w-0 items-center gap-4">
				<RiTerminalBoxLine className="size-14 shrink-0 text-text-muted" />
				<span className="min-w-0 flex-1 truncate tr-text-ui" title={command.name}>
					{command.name}
				</span>
				<span className="shrink-0 text-text-muted tr-text-metadata">{command.status}</span>
			</div>
			<code className="truncate text-text-muted tr-code-text-small" title={command.command}>
				{command.command}
			</code>
			<div className="flex items-center gap-4">
				<Button
					variant="ghost"
					size="sm"
					data-testid="resource-logs"
					onClick={() => props.onLogs(command)}
				>
					Logs
				</Button>
				{active ? (
					<StopAction
						action={action}
						disabled={!props.authoritative || command.status === "stopping"}
						onStop={() => props.onStopCommand(command.id)}
					/>
				) : null}
				{command.exitCode !== undefined && command.exitCode !== null ? (
					<span className="text-text-muted tr-text-metadata">Exit {command.exitCode}</span>
				) : null}
			</div>
			{command.errorMessage ? (
				<p role="alert" className="break-words text-feedback-error tr-text-metadata">
					{command.errorMessage}
				</p>
			) : null}
			<ActionError action={action} />
		</div>
	);
}

function SubagentRow({
	child,
	active,
	props,
}: {
	child: SubagentResourceSummary;
	active: boolean;
	props: Props;
}) {
	const action = props.actions[`subagent:${child.childSessionId}`];
	return (
		<div
			data-testid="resource-subagent"
			data-resource-id={child.childSessionId}
			data-status={child.status}
			className="flex min-w-0 flex-col gap-4 border-border-muted border-b py-8 last:border-b-0"
		>
			<div className="flex min-w-0 items-center gap-4">
				<RiRobot2Line className="size-14 shrink-0 text-text-muted" />
				<span className="min-w-0 flex-1 truncate tr-text-ui">{child.roleName ?? "Subagent"}</span>
				<span className="shrink-0 text-text-muted tr-text-metadata">{child.status}</span>
			</div>
			<p className="line-clamp-2 break-words text-text-muted tr-text-metadata" title={child.task}>
				{child.task}
			</p>
			<div className="flex items-center gap-4">
				<Button
					variant="ghost"
					size="sm"
					data-testid="resource-transcript"
					onClick={() => props.onTranscript(child.childSessionId)}
				>
					Transcript
				</Button>
				{active ? (
					<StopAction
						action={action}
						disabled={!props.authoritative || !!props.actions.all?.pending}
						onStop={() => props.onStopSubagent(child.childSessionId)}
					/>
				) : null}
			</div>
			{child.abortReason ? (
				<p className="break-words text-text-muted tr-text-metadata">{child.abortReason}</p>
			) : null}
			<ActionError action={action} />
		</div>
	);
}

export function ResourcesContent(props: Props) {
	const [finishedOpen, setFinishedOpen] = useState(false);
	const finishedCount = props.finishedCommands.length + props.finishedSubagents.length;
	const Chevron = finishedOpen ? RiArrowDownSLine : RiArrowRightSLine;
	return (
		<div className="flex min-w-0 flex-col gap-12 p-12">
			<h2 className="tr-text-ui">Resources</h2>
			{props.loading ? (
				<p className="text-text-muted tr-text-metadata">Loading resources…</p>
			) : null}
			{props.stale ? (
				<p className="text-feedback-warning tr-text-metadata">
					Resources are stale. Controls are disabled until refreshed.
				</p>
			) : null}
			{props.error ? (
				<div role="alert" className="text-feedback-error tr-text-metadata">
					{props.error}
					<Button variant="ghost" size="sm" data-testid="resources-retry" onClick={props.onRetry}>
						Retry
					</Button>
				</div>
			) : null}
			<section data-testid="resources-commands" aria-label="Commands">
				<h3 className="text-text-muted tr-text-metadata">Commands · {props.commands.length}</h3>
				{props.commands.map((command) => (
					<CommandRow key={command.id} command={command} active props={props} />
				))}
				{!props.loading && !props.stale && props.commands.length === 0 ? (
					<p className="py-8 text-text-muted tr-text-metadata">No active commands.</p>
				) : null}
			</section>
			<section data-testid="resources-subagents" aria-label="Subagents">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<h3 className="text-text-muted tr-text-metadata">Subagents · {props.subagents.length}</h3>
					{props.subagents.length > 0 ? (
						<Button
							variant="ghost"
							size="sm"
							data-testid="resources-stop-all"
							disabled={
								!props.authoritative ||
								props.actions.all?.pending ||
								props.subagents.some(
									(child) => props.actions[`subagent:${child.childSessionId}`]?.pending,
								)
							}
							onClick={props.onStopAll}
						>
							{props.actions.all?.pending ? "Stopping…" : "Stop all subagents"}
						</Button>
					) : null}
				</div>
				<ActionError action={props.actions.all} />
				{props.subagents.map((child) => (
					<SubagentRow key={child.childSessionId} child={child} active props={props} />
				))}
				{!props.loading && !props.stale && props.subagents.length === 0 ? (
					<p className="py-8 text-text-muted tr-text-metadata">No active subagents.</p>
				) : null}
			</section>
			<div className="border-border-muted border-t pt-8">
				<Button
					variant="ghost"
					size="sm"
					className="gap-4"
					data-testid="resources-finished-toggle"
					aria-expanded={finishedOpen}
					onClick={() => setFinishedOpen(!finishedOpen)}
				>
					<Chevron className="size-16" />
					Finished · {finishedCount}
				</Button>
				{finishedOpen ? (
					<div>
						{props.finishedCommands.map((command) => (
							<CommandRow key={command.id} command={command} active={false} props={props} />
						))}
						{props.finishedSubagents.map((child) => (
							<SubagentRow key={child.childSessionId} child={child} active={false} props={props} />
						))}
						{finishedCount === 0 ? (
							<p className="py-8 text-text-muted tr-text-metadata">No finished resources.</p>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
