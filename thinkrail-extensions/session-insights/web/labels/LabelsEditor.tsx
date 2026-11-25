import { RiAddLine, RiCloseLine, RiPriceTag3Fill, RiPriceTag3Line } from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, useT } from "@thinkrail/locales/react";
import type { LabelCount, LabelRules } from "@thinkrail/pi-session-insights/core";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Popover, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { formatCount } from "../format";
import { useKeyedQuery } from "../useKeyedQuery";
import { announceLabelsChanged, loadLabels, QUICK_LABELS, saveLabels } from "./api";

/** The server's limits, typed against the core's literal (the web half may not value-import it). */
const RULES: Pick<LabelRules, "labelChars" | "labelsPerSession" | "noteChars"> = {
	labelChars: 40,
	labelsPerSession: 12,
	noteChars: 2000,
};
const SUGGESTIONS = 8;
const CHIPS = 3;

const CHIP =
	"inline-flex max-w-160 min-w-0 shrink-0 items-center gap-2 rounded-full border border-border-default bg-control-bg px-6 tr-text-metadata text-text-default";

/** A session's labels as chips: the first `max`, then "+N" (all of them with `all`). */
export function LabelChips({
	labels,
	all = false,
	max = CHIPS,
	testId = "session-insights-label",
	className,
}: {
	labels: readonly string[];
	all?: boolean;
	max?: number;
	testId?: string;
	className?: string;
}) {
	const t = useT();
	if (labels.length === 0) return null;
	const shown = all ? labels : labels.slice(0, max);
	return (
		<span className={cn("flex min-w-0 flex-wrap items-center gap-4", className)}>
			{shown.map((label) => (
				<span key={label} data-testid={testId} className={CHIP} title={label}>
					<span className="truncate">{label}</span>
				</span>
			))}
			{shown.length < labels.length ? (
				<span className="tr-text-metadata text-text-subtle" title={labels.join(", ")}>
					{t("sessionInsights.labels.more", { count: labels.length - shown.length })}
				</span>
			) : null}
		</span>
	);
}

function clean(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

type Problem = "tooLong" | "tooMany" | "full" | "failed" | null;

const PROBLEM_TEXT = {
	tooLong: "sessionInsights.labels.tooLong",
	tooMany: "sessionInsights.labels.tooMany",
	full: "sessionInsights.labels.full",
	failed: "sessionInsights.labels.failed",
} as const;

/** The editor's body: the labels as chips, the field that adds one, suggestions and the note. */
export function LabelsForm({
	host,
	sessionId,
	initial,
	vocabulary,
	inputRef,
	onDone,
}: {
	host: PanelHost;
	sessionId: string;
	initial: readonly string[];
	vocabulary: readonly LabelCount[];
	inputRef: RefObject<HTMLInputElement | null>;
	onDone: () => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const inputId = useId();
	const noteId = useId();
	const [labels, setLabels] = useState<readonly string[]>(initial);
	const [draft, setDraft] = useState("");
	const [edited, setNote] = useState<string | null>(null);
	const [problem, setProblem] = useState<Problem>(null);
	const [saving, setSaving] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const stored = useKeyedQuery(`${sessionId}:${attempt}`, (signal) =>
		loadLabels(host, [sessionId], signal),
	);
	const loadFailed = stored.kind === "failed" || stored.kind === "version";
	const note =
		edited ??
		(stored.kind === "ready"
			? (stored.value.sessions.find((entry) => entry.sessionId === sessionId)?.note ?? "")
			: null);
	const has = (label: string) =>
		labels.some((item) => item.toLocaleLowerCase() === label.toLocaleLowerCase());
	const add = (value: string) => {
		const label = clean(value);
		if (!label) return;
		if (label.length > RULES.labelChars) {
			setProblem("tooLong");
			return;
		}
		if (has(label)) {
			setDraft("");
			return;
		}
		if (labels.length >= RULES.labelsPerSession) {
			setProblem("tooMany");
			return;
		}
		setLabels([...labels, label]);
		setDraft("");
		setProblem(null);
	};
	const remove = (label: string) => setLabels(labels.filter((item) => item !== label));
	const wanted = clean(draft).toLocaleLowerCase();
	const pool = [
		...vocabulary.map((entry) => ({ label: entry.label, sessions: entry.sessions })),
		...QUICK_LABELS.filter(
			(label) => !vocabulary.some((entry) => entry.label.toLocaleLowerCase() === label),
		).map((label) => ({ label, sessions: 0 })),
	];
	const suggestions = pool
		.filter((entry) => !has(entry.label))
		.filter((entry) => !wanted || entry.label.toLocaleLowerCase().includes(wanted))
		.slice(0, SUGGESTIONS);
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (isImeComposing(event.nativeEvent)) return;
		if (event.key === "Enter") {
			event.preventDefault();
			add(draft);
		} else if (event.key === "Backspace" && draft === "" && labels.length > 0) {
			setLabels(labels.slice(0, -1));
		}
	};
	const save = () => {
		setSaving(true);
		setProblem(null);
		const pending = clean(draft);
		const next = pending && !has(pending) ? [...labels, pending] : labels;
		saveLabels(host, { sessionId, labels: next, note: note?.trim() ? note : null }).then(
			(result) => {
				setSaving(false);
				if (!result.ok) {
					setProblem("full");
					return;
				}
				announceLabelsChanged();
				onDone();
			},
			() => {
				setSaving(false);
				setProblem("failed");
			},
		);
	};
	return (
		<div data-testid="session-insights-labels-editor" className="flex w-320 flex-col gap-8 p-12">
			<span className="tr-title-compact text-text-default">{t("sessionInsights.labels.edit")}</span>
			{labels.length > 0 ? (
				<ul aria-label={t("sessionInsights.labels.current")} className="flex flex-wrap gap-4">
					{labels.map((label) => (
						<li key={label} className={cn(CHIP, "pr-0")}>
							<span className="truncate" title={label}>
								{label}
							</span>
							<IconButton
								icon={RiCloseLine}
								size="s"
								label={t("sessionInsights.labels.remove", { label })}
								data-testid="session-insights-label-remove"
								onClick={() => remove(label)}
							/>
						</li>
					))}
				</ul>
			) : null}
			<label htmlFor={inputId} className="sr-only">
				{t("sessionInsights.labels.add")}
			</label>
			<span className="flex items-center gap-4">
				<input
					ref={inputRef}
					id={inputId}
					type="text"
					data-testid="session-insights-label-input"
					value={draft}
					maxLength={RULES.labelChars * 2}
					autoComplete="off"
					placeholder={t("sessionInsights.labels.addPlaceholder")}
					onChange={(event) => {
						setDraft(event.currentTarget.value);
						setProblem(null);
					}}
					onKeyDown={onKeyDown}
					className="min-w-0 flex-1 rounded-sm border border-control-border-default bg-control-bg px-8 py-2 tr-text-ui text-text-default placeholder:text-text-subtle focus-visible:focus-ring"
				/>
				<IconButton
					icon={RiAddLine}
					size="s"
					label={t("sessionInsights.labels.add")}
					data-testid="session-insights-label-add"
					disabled={!clean(draft)}
					onClick={() => add(draft)}
				/>
			</span>
			{suggestions.length > 0 ? (
				<div className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("common.suggestions")}</span>
					<span className="flex flex-wrap gap-4">
						{suggestions.map((entry) => (
							<button
								key={entry.label}
								type="button"
								data-testid="session-insights-label-suggestion"
								onClick={() => add(entry.label)}
								className={cn(
									CHIP,
									"border-dashed text-text-muted hover:text-text-default focus-visible:focus-ring",
								)}
							>
								<span className="truncate">{entry.label}</span>
								{entry.sessions > 0 ? (
									<span className="text-text-subtle">{formatCount(locale, entry.sessions)}</span>
								) : null}
							</button>
						))}
					</span>
				</div>
			) : null}
			<label htmlFor={noteId} className="tr-text-metadata text-text-muted">
				{t("sessionInsights.labels.note")}
			</label>
			<Textarea
				id={noteId}
				data-testid="session-insights-note-input"
				rows={4}
				value={note ?? ""}
				disabled={note === null}
				maxLength={RULES.noteChars}
				placeholder={
					note !== null
						? t("sessionInsights.labels.notePlaceholder")
						: loadFailed
							? t("sessionInsights.labels.noteFailed")
							: t("sessionInsights.labels.loadingNote")
				}
				onChange={(event) => setNote(event.currentTarget.value)}
			/>
			<span className="flex items-start justify-between gap-8 tr-text-metadata text-text-subtle">
				<span>{t("sessionInsights.labels.privacy")}</span>
				<span className="shrink-0 tabular-nums">
					{t("sessionInsights.labels.noteCount", {
						count: formatCount(locale, note?.length ?? 0),
						max: formatCount(locale, RULES.noteChars),
					})}
				</span>
			</span>
			{loadFailed ? (
				<span
					role="alert"
					data-testid="session-insights-note-failed"
					className="flex items-center justify-between gap-8 tr-text-metadata text-feedback-error"
				>
					{t("sessionInsights.labels.noteFailed")}
					<Button variant="ghost" size="s" onClick={() => setAttempt(attempt + 1)}>
						{t("common.retry")}
					</Button>
				</span>
			) : null}
			{problem ? (
				<span role="alert" className="tr-text-metadata text-feedback-error">
					{t(PROBLEM_TEXT[problem], {
						max: formatCount(
							locale,
							problem === "tooLong" ? RULES.labelChars : RULES.labelsPerSession,
						),
					})}
				</span>
			) : null}
			<span className="flex justify-end gap-8">
				<Button variant="ghost" size="s" onClick={onDone}>
					{t("common.cancel")}
				</Button>
				<Button
					variant="primary"
					size="s"
					data-testid="session-insights-labels-save"
					loading={saving}
					disabled={note === null}
					onClick={save}
				>
					{t("common.save")}
				</Button>
			</span>
		</div>
	);
}

/** The labels and note editor behind a tag button (filled when the session has any). */
export function LabelsButton({
	host,
	sessionId,
	labels,
	noted,
	vocabulary,
	testId = "session-insights-labels",
	className,
	trigger,
	...grid
}: {
	host: PanelHost;
	sessionId: string;
	labels: readonly string[];
	noted: boolean;
	vocabulary: readonly LabelCount[];
	testId?: string;
	className?: string;
	/** A custom trigger (a text button) instead of the icon. */
	trigger?: ReactNode;
	"data-grid-row"?: number;
	"data-grid-col"?: number;
	"data-grid-key"?: string;
	tabIndex?: number;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const marked = labels.length > 0 || noted;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				{trigger ?? (
					<IconButton
						icon={marked ? RiPriceTag3Fill : RiPriceTag3Line}
						size="s"
						label={t("sessionInsights.labels.button")}
						data-testid={testId}
						aria-haspopup="dialog"
						wrapTrigger
						className={className}
						{...grid}
					/>
				)}
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="p-0"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					input.current?.focus();
				}}
			>
				{open ? (
					<LabelsForm
						host={host}
						sessionId={sessionId}
						initial={labels}
						vocabulary={vocabulary}
						inputRef={input}
						onDone={() => setOpen(false)}
					/>
				) : null}
			</PopoverContent>
		</Popover>
	);
}
