import { cn, remixicon, ui } from "@thinkrail/ext/view";
import type { ReactNode } from "react";
import { type Decision, formatAgo, type RuleAction, type RuleView } from "./model";

const { RiCheckboxFill, RiCheckboxBlankLine, RiDeleteBinLine } = remixicon;

export const Segmented = <T extends string>({
	options,
	value,
	onChange,
	testId,
}: {
	options: readonly { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
	testId: string;
}) => (
	<div className="flex shrink-0 items-center gap-2 rounded-md border border-border-muted p-2">
		{options.map((option) => (
			<button
				key={option.value}
				type="button"
				aria-pressed={option.value === value}
				data-testid={`${testId}-${option.value}`}
				onClick={() => onChange(option.value)}
				className={cn(
					"rounded-sm px-8 py-2 tr-text-metadata transition-colors",
					option.value === value
						? "bg-control-bg-hovered text-text-default"
						: "text-text-muted hover:text-text-default",
				)}
			>
				{option.label}
			</button>
		))}
	</div>
);

export const VerdictChip = ({ verdict }: { verdict: RuleAction }) => (
	<span
		className={cn(
			"shrink-0 rounded-sm px-4 tr-text-metadata uppercase",
			verdict === "block"
				? "bg-feedback-error-subtle text-feedback-error"
				: "bg-feedback-success-subtle text-feedback-success",
		)}
	>
		{verdict}
	</span>
);

export const Tag = ({ children }: { children: ReactNode }) => (
	<span className="shrink-0 rounded-sm border border-border-muted px-4 tr-text-metadata text-text-muted">
		{children}
	</span>
);

export const Empty = ({ title, detail }: { title: string; detail: string }) => (
	<div
		data-testid="tool-guard-empty"
		className="flex flex-col items-center justify-center gap-4 px-24 py-32 text-center"
	>
		<p className="tr-text-ui text-text-default">{title}</p>
		<p className="tr-text-metadata text-text-muted">{detail}</p>
	</div>
);

export const DecisionRow = ({ decision, now }: { decision: Decision; now: number }) => (
	<li
		data-testid="tool-guard-decision"
		data-verdict={decision.verdict}
		className="flex flex-col gap-4 border-b border-border-muted px-12 py-8 last:border-b-0"
	>
		<div className="flex items-center gap-8">
			<VerdictChip verdict={decision.verdict} />
			<span className="tr-code-text text-text-muted">{decision.tool}</span>
			<span className="ml-auto shrink-0 tr-text-metadata text-text-subtle">
				{formatAgo(Math.max(0, now - decision.at))}
			</span>
		</div>
		<p className="line-clamp-2 break-all tr-code-text text-text-default" title={decision.summary}>
			{decision.summary}
		</p>
		<p className="truncate tr-text-metadata text-text-muted">
			{decision.rule ? decision.rule.label : "no rule matched"}
			<span className="text-text-subtle"> · {decision.sessionTitle ?? decision.sessionId}</span>
		</p>
	</li>
);

export const RuleRow = ({
	rule,
	onToggle,
	onRemove,
}: {
	rule: RuleView;
	onToggle: () => void;
	onRemove: () => void;
}) => (
	<li
		data-testid="tool-guard-rule"
		data-rule-id={rule.id}
		data-enabled={rule.enabled}
		className="flex items-start gap-8 border-b border-border-muted px-12 py-8 last:border-b-0"
	>
		<ui.IconTooltip label={rule.enabled ? "Turn off" : "Turn on"}>
			<ui.Button
				variant="ghost"
				size="icon"
				aria-label={rule.enabled ? "Turn off" : "Turn on"}
				aria-pressed={rule.enabled}
				data-testid="tool-guard-rule-toggle"
				onClick={onToggle}
			>
				{rule.enabled ? (
					<RiCheckboxFill className="size-16 text-primary" />
				) : (
					<RiCheckboxBlankLine className="size-16" />
				)}
			</ui.Button>
		</ui.IconTooltip>
		<div className={cn("flex min-w-0 flex-1 flex-col gap-2 pt-4", !rule.enabled && "opacity-60")}>
			<div className="flex min-w-0 items-center gap-4">
				<VerdictChip verdict={rule.action} />
				<Tag>{rule.target}</Tag>
				{rule.source === "builtin" && <Tag>built-in</Tag>}
			</div>
			<p className="break-all tr-code-text text-text-default">{rule.label}</p>
			{rule.description && <p className="tr-text-metadata text-text-muted">{rule.description}</p>}
		</div>
		{rule.source === "user" && (
			<ui.IconTooltip label="Remove rule">
				<ui.Button
					variant="ghost"
					size="icon"
					aria-label="Remove rule"
					data-testid="tool-guard-rule-remove"
					onClick={onRemove}
				>
					<RiDeleteBinLine className="size-14" />
				</ui.Button>
			</ui.IconTooltip>
		)}
	</li>
);
