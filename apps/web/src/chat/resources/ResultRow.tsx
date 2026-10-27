import { RiArrowRightSLine, RiFileList3Line } from "@remixicon/react";
import type {
	BackgroundCommandCompletionDetails,
	DelegationRunDetails,
} from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { MouseEvent, ReactNode } from "react";
import {
	commandState,
	ExitBadge,
	formatElapsed,
	KindGlyph,
	type ResourceState,
	StateText,
	subagentState,
} from "./resourceRow";

export type ResultSource =
	| { kind: "command"; details: BackgroundCommandCompletionDetails }
	| { kind: "subagent"; details: DelegationRunDetails };

export type ResultReceipt = "received" | "awaitingReply";

export interface ResultRowProps {
	source: ResultSource;
	receipt?: ResultReceipt | undefined;
	expanded: boolean;
	onToggle?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
	toggleRef?: ((element: HTMLElement | null) => void) | undefined;
	onOpen?: (() => void) | undefined;
	metaLead?: ReactNode;
	meta?: string | undefined;
	teaser?: string | undefined;
	children?: ReactNode;
}

const ESC = 27;

function stripAnsi(line: string): string {
	let out = "";
	for (let i = 0; i < line.length; i++) {
		if (line.charCodeAt(i) !== ESC) {
			out += line[i];
			continue;
		}
		if (line[i + 1] !== "[") continue;
		i += 2;
		while (i < line.length) {
			const code = line.charCodeAt(i);
			if (code >= 0x40 && code <= 0x7e) break;
			i++;
		}
	}
	return out;
}

export function outputTeaser(text: string): string {
	const lines = text.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = stripAnsi(lines[i] ?? "").trim();
		if (line) return line;
	}
	return "";
}

function resultFacts(source: ResultSource): {
	name: string;
	state: ResourceState;
	durationMs: number | null;
	exitCode: number | null | undefined;
} {
	if (source.kind === "command") {
		const d = source.details;
		return {
			name: d.name,
			state: commandState(d.status, d.exitCode),
			durationMs: d.finishedAt - d.startedAt,
			exitCode: d.exitCode,
		};
	}
	const d = source.details;
	return {
		name: d.roleName ?? "subagent",
		state: subagentState(d.status),
		durationMs: d.durationMs > 0 ? d.durationMs : null,
		exitCode: undefined,
	};
}

export function ResultRow({
	source,
	receipt,
	expanded,
	onToggle,
	toggleRef,
	onOpen,
	metaLead,
	meta,
	teaser,
	children,
}: ResultRowProps) {
	const t = useT();
	const { name, state, durationMs, exitCode } = resultFacts(source);
	const command = source.kind === "command";
	const line = teaser ?? (command ? outputTeaser(source.details.output.text) : "");
	const headerClass =
		"flex min-w-0 flex-1 items-center gap-4 rounded-sm px-4 py-2 text-left outline-none";
	const header = (
		<>
			{onToggle ? (
				<RiArrowRightSLine
					className={cn("size-16 shrink-0 transition-transform", expanded && "rotate-90")}
				/>
			) : (
				<span className="size-16 shrink-0" />
			)}
			<KindGlyph kind={source.kind} state={state} dotRingClassName="ring-container-workspace-bg" />
			{receipt ? (
				<span data-testid="background-result-receipt" className="shrink-0 text-text-subtle">
					{receipt === "received"
						? t("resources.result.receivedByAgent")
						: t("resources.result.awaitingReply")}
				</span>
			) : null}
			<span className="shrink-0 text-text-subtle">
				{command ? t("resources.result.background") : t("resources.result.subagent")}
			</span>
			<span className="min-w-0 shrink truncate text-text-default" title={name}>
				{name}
			</span>
			<StateText state={state} kind={source.kind} />
			{durationMs !== null && Number.isFinite(durationMs) ? (
				<span className="shrink-0 tabular-nums">{formatElapsed(t, durationMs)}</span>
			) : null}
			{exitCode !== undefined && exitCode !== null ? <ExitBadge exitCode={exitCode} /> : null}
			{metaLead ? <span className="flex min-w-0 shrink">{metaLead}</span> : null}
			{meta ? (
				<span className="min-w-0 shrink truncate" title={meta}>
					{meta}
				</span>
			) : null}
			{line && !expanded ? (
				<span
					data-testid="background-result-teaser"
					className={cn(
						"min-w-0 flex-1 truncate text-text-subtle",
						command && "tr-code-text-small",
					)}
					title={line}
				>
					{line}
				</span>
			) : (
				<span className="flex-1" />
			)}
		</>
	);
	return (
		<div className="text-text-muted tr-text-metadata">
			<div className="flex min-w-0 items-center gap-4">
				{onToggle ? (
					<button
						ref={toggleRef}
						type="button"
						data-testid="background-result-toggle"
						aria-expanded={expanded}
						onClick={onToggle}
						className={cn(
							headerClass,
							"cursor-pointer select-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary",
						)}
					>
						{header}
					</button>
				) : (
					<div className={headerClass}>{header}</div>
				)}
				{onOpen ? (
					<button
						type="button"
						data-testid="background-result-open"
						onClick={onOpen}
						className="flex shrink-0 items-center gap-4 rounded-sm px-4 py-2 text-primary outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
					>
						<RiFileList3Line className="size-12 shrink-0" />
						{command ? t("resources.result.openLog") : t("resources.result.transcript")}
					</button>
				) : null}
			</div>
			{expanded && children ? (
				<div data-testid="background-result-body" className="py-4 pl-24">
					{children}
				</div>
			) : null}
		</div>
	);
}
