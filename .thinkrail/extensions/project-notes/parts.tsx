import { cn, remixicon, ui } from "@thinkrail/ext/view";
import type { ReactNode } from "react";
import { estimateTokens, type Injection, type Note, noteText, PROMPT_CAP, titleOf } from "./model";

const { RiPencilLine, RiRobot2Line } = remixicon;

const number = new Intl.NumberFormat("en-US");

export const formatCount = (value: number) => number.format(value);

export const sizeText = (chars: number) =>
	`${formatCount(chars)} chars · ~${formatCount(estimateTokens(chars))} tokens`;

export const Tag = ({ children, tone }: { children: ReactNode; tone?: "warning" }) => (
	<span
		className={cn(
			"inline-flex shrink-0 items-center gap-2 rounded-sm px-4 tr-text-metadata",
			tone === "warning"
				? "bg-feedback-warning-subtle text-feedback-warning"
				: "border border-border-muted text-text-muted",
		)}
	>
		{children}
	</span>
);

export const Empty = ({ title, detail }: { title: string; detail: string }) => (
	<div
		data-testid="project-notes-empty"
		className="flex flex-1 flex-col items-center justify-center gap-4 px-24 py-32 text-center"
	>
		<p className="tr-title-compact text-text-default">{title}</p>
		<p className="tr-text-metadata text-text-muted">{detail}</p>
	</div>
);

export const Budget = ({ plan }: { plan: Injection }) => {
	const used = plan.text.length;
	const percent = Math.min(100, Math.round((used / PROMPT_CAP) * 100));
	return (
		<div data-testid="project-notes-budget" className="flex flex-col gap-4">
			<div className="flex items-baseline gap-8 tr-text-metadata">
				<span className="text-text-muted">Sent with every run</span>
				<span className="ml-auto tabular-nums text-text-default">
					{formatCount(used)} / {formatCount(PROMPT_CAP)} chars
				</span>
				<span className="tabular-nums text-text-subtle">
					~{formatCount(estimateTokens(used))} tokens
				</span>
			</div>
			<div className="h-4 overflow-hidden rounded-full bg-control-bg">
				<div
					className={cn(
						"h-full rounded-full",
						plan.skipped.length > 0 ? "bg-feedback-warning" : "bg-primary",
					)}
					style={{ width: `${percent}%` }}
				/>
			</div>
			<p className="tr-text-metadata text-text-muted">
				Enabled notes go into the system prompt of each new agent run in this project, top to
				bottom, up to {formatCount(PROMPT_CAP)} characters.
			</p>
			{plan.skipped.length > 0 && (
				<p data-testid="project-notes-over-cap" className="tr-text-metadata text-feedback-warning">
					{plan.skipped.length === 1 ? "1 note is" : `${plan.skipped.length} notes are`} past the
					cap and not sent. Turn off or shorten notes above to make room.
				</p>
			)}
		</div>
	);
};

export const NoteRow = ({
	note,
	skipped,
	onToggle,
	onEdit,
}: {
	note: Note;
	skipped: boolean;
	onToggle: () => void;
	onEdit: () => void;
}) => (
	<li
		data-testid="project-notes-note"
		data-note-id={note.id}
		data-enabled={note.enabled}
		data-sent={note.enabled && !skipped}
		className="group flex items-start gap-12 border-b border-border-muted px-12 py-8 last:border-b-0 hover:bg-control-bg-hovered"
	>
		<ui.Switch
			className="mt-2"
			checked={note.enabled}
			aria-label={note.enabled ? "Stop sending this note" : "Send this note"}
			data-testid="project-notes-toggle"
			onCheckedChange={onToggle}
		/>
		<button
			type="button"
			data-testid="project-notes-open"
			onClick={onEdit}
			className={cn(
				"flex min-w-0 flex-1 flex-col gap-2 text-left outline-none",
				!note.enabled && "opacity-60",
			)}
		>
			<span className="truncate tr-text-ui text-text-default">{titleOf(note)}</span>
			<span className="line-clamp-2 whitespace-pre-wrap break-words tr-text-metadata text-text-muted">
				{note.body}
			</span>
			<span className="flex flex-wrap items-center gap-4">
				<span className="tabular-nums tr-text-metadata text-text-subtle">
					~{formatCount(estimateTokens(noteText(note).length))} tokens
				</span>
				{note.source === "agent" && (
					<Tag>
						<RiRobot2Line className="size-14" /> added by agent
					</Tag>
				)}
				{skipped && <Tag tone="warning">over cap, not sent</Tag>}
			</span>
		</button>
		<ui.IconTooltip label="Edit note">
			<ui.Button
				variant="ghost"
				size="icon"
				aria-label="Edit note"
				data-testid="project-notes-edit"
				className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
				onClick={onEdit}
			>
				<RiPencilLine className="size-14" />
			</ui.Button>
		</ui.IconTooltip>
	</li>
);
