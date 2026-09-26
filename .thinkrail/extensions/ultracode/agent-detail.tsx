import { remixicon, ui } from "@thinkrail/ext/view";
import type { ReactNode } from "react";
import {
	type AgentRow,
	formatCost,
	formatDuration,
	formatTokens,
	type PhaseRow,
	tokensOf,
} from "./model";
import { AGENT_TONE, StatusDot } from "./parts";

const { RiCloseLine } = remixicon;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
	<section className="flex min-h-0 flex-col gap-4">
		<h3 className="tr-text-metadata text-text-muted">{title}</h3>
		{children}
	</section>
);

const Block = ({ testId, children }: { testId: string; children: ReactNode }) => (
	<pre
		data-testid={testId}
		className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-muted bg-container-elevated-bg px-12 py-8 tr-code-text text-text-default"
	>
		{children}
	</pre>
);

const json = (value: unknown) => {
	try {
		return typeof value === "string" ? value : JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
};

export const AgentDetail = ({
	agent,
	phase,
	now,
	onClose,
}: {
	agent: AgentRow;
	phase: PhaseRow | undefined;
	now: number;
	onClose: () => void;
}) => {
	const end = agent.endedAt ?? now;
	const tone = AGENT_TONE[agent.state];
	return (
		<aside
			data-testid="ultracode-agent-detail"
			data-state={agent.state}
			className="flex w-[420px] shrink-0 flex-col gap-12 overflow-auto border-l border-border-muted p-12"
		>
			<div className="flex items-center gap-8">
				<StatusDot state={agent.state} />
				<span className="min-w-0 flex-1 truncate tr-title-compact text-text-default">
					{agent.label}
				</span>
				<ui.Button
					variant="ghost"
					size="icon"
					aria-label="Close agent details"
					data-testid="ultracode-agent-close"
					onClick={onClose}
				>
					<RiCloseLine className="size-14" />
				</ui.Button>
			</div>
			<dl className="grid grid-cols-[auto_1fr] gap-x-12 gap-y-2 tr-text-metadata">
				<dt className="text-text-subtle">Status</dt>
				<dd className={tone.text}>
					{tone.label}
					{agent.replayed ? " (replayed)" : ""}
					{agent.attempt > 1 ? ` · attempt ${agent.attempt}` : ""}
				</dd>
				<dt className="text-text-subtle">Phase</dt>
				<dd className="text-text-default">{phase?.title ?? "none"}</dd>
				<dt className="text-text-subtle">Model</dt>
				<dd className="truncate text-text-default">{agent.model ?? "default"}</dd>
				<dt className="text-text-subtle">Usage</dt>
				<dd className="tabular-nums text-text-default">
					{formatTokens(tokensOf(agent.usage))} tokens · {agent.usage.turns} turns ·{" "}
					{formatCost(agent.usage.cost)}
				</dd>
				<dt className="text-text-subtle">Time</dt>
				<dd className="tabular-nums text-text-default">
					{agent.startedAt === undefined ? "not started" : formatDuration(end - agent.startedAt)}
				</dd>
				{agent.childId && (
					<>
						<dt className="text-text-subtle">Session</dt>
						<dd className="truncate tr-code-text text-text-muted">{agent.childId}</dd>
					</>
				)}
			</dl>
			{agent.activity && <p className="tr-text-metadata text-primary">Now: {agent.activity}</p>}
			{agent.error && (
				<Section title="Error">
					<p
						data-testid="ultracode-agent-error"
						className="rounded-sm bg-feedback-error-subtle px-8 py-4 tr-text-metadata text-text-default"
					>
						{agent.error}
					</p>
				</Section>
			)}
			{agent.result !== undefined && (
				<Section title="Structured result">
					<Block testId="ultracode-agent-result">{json(agent.result)}</Block>
				</Section>
			)}
			{agent.output && agent.result === undefined && (
				<Section title="Output">
					<Block testId="ultracode-agent-output">{agent.output}</Block>
				</Section>
			)}
			<Section title="Prompt">
				<Block testId="ultracode-agent-prompt">{agent.prompt}</Block>
			</Section>
		</aside>
	);
};
