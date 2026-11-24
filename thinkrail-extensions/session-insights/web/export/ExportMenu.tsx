import {
	RiArrowDownSLine,
	RiCodeSSlashLine,
	RiDownload2Line,
	RiFolderOpenLine,
	RiPulseLine,
	RiTestTubeLine,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { localeOf, type Translator, useT } from "@thinkrail/locales/react";
import type {
	ExportCheckFinding,
	ExportCut,
	ExportErrorCode,
	ExportKind,
	ExportNote,
	ExportResult,
	ExportRules,
} from "@thinkrail/pi-session-insights/core";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useId, useState } from "react";
import { formatBytes, formatCount } from "../format";
import { VersionSkew } from "../session/api";
import { runExport } from "./api";

/** The fixture's snapshot limits, typed against the core's literal (no value import in the browser). */
const SNAPSHOT: ExportRules["snapshot"] = { files: 400, bytes: 20 * 1024 * 1024 };
const NAME_CHARS: ExportRules["nameChars"] = 60;

/** A turn the fixture can end at. */
export interface ExportTurn {
	n: number;
	label: string;
}

const KIND_ICON = {
	html: RiCodeSSlashLine,
	trace: RiPulseLine,
	fixture: RiTestTubeLine,
} as const satisfies Record<ExportKind, unknown>;

const KIND_ITEM = {
	html: "sessionInsights.export.kind.html",
	trace: "sessionInsights.export.kind.trace",
	fixture: "sessionInsights.export.kind.fixture",
} as const;

const KIND_TITLE = {
	html: "sessionInsights.export.title.html",
	trace: "sessionInsights.export.title.trace",
	fixture: "sessionInsights.export.title.fixture",
} as const;

const KIND_ABOUT = {
	html: "sessionInsights.export.about.html",
	trace: "sessionInsights.export.about.trace",
	fixture: "sessionInsights.export.about.fixture",
} as const;

const ERROR_TEXT = {
	SESSION_NOT_FOUND: "sessionInsights.export.error.SESSION_NOT_FOUND",
	NO_ARTIFACTS_DIR: "sessionInsights.export.error.NO_ARTIFACTS_DIR",
	CUT_NOT_FOUND: "sessionInsights.export.error.CUT_NOT_FOUND",
	CHECK_FAILED: "sessionInsights.export.error.CHECK_FAILED",
	WRITE_FAILED: "sessionInsights.export.error.WRITE_FAILED",
} as const satisfies Record<ExportErrorCode, string>;

const FINDING_TEXT = {
	privateKey: "sessionInsights.export.finding.privateKey",
	keyShape: "sessionInsights.export.finding.keyShape",
	authHeader: "sessionInsights.export.finding.authHeader",
	assignment: "sessionInsights.export.finding.assignment",
	queryValue: "sessionInsights.export.finding.queryValue",
	jsonKey: "sessionInsights.export.finding.jsonKey",
	urlCredentials: "sessionInsights.export.finding.urlCredentials",
	email: "sessionInsights.export.finding.email",
	homePath: "sessionInsights.export.finding.homePath",
	networkReference: "sessionInsights.export.finding.networkReference",
} as const satisfies Record<ExportCheckFinding, string>;

const NOTE_TEXT = {
	labels: "sessionInsights.export.note.labels",
	snapshot: "sessionInsights.export.note.snapshot",
	noSnapshot: "sessionInsights.export.note.noSnapshot",
	snapshotTooLarge: "sessionInsights.export.note.snapshotTooLarge",
	binaryOmitted: "sessionInsights.export.note.binaryOmitted",
	privatePathOmitted: "sessionInsights.export.note.privatePathOmitted",
	maskClashOmitted: "sessionInsights.export.note.maskClashOmitted",
	childrenMissing: "sessionInsights.export.note.childrenMissing",
} as const satisfies Record<ExportNote, string>;

export type ExportPhase =
	| { kind: "options" }
	| { kind: "running" }
	| { kind: "done"; result: Extract<ExportResult, { ok: true }> }
	| { kind: "failed"; result: Extract<ExportResult, { ok: false }> }
	| { kind: "broken"; version: boolean };

const FIELD =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default placeholder:text-text-subtle focus-visible:focus-ring";

export interface CutOption {
	value: string;
	cut: ExportCut;
	label: string;
}

/** The fixture's cut points: each turn's end, then right after the selected step when there is one. */
export function cutOptions(
	t: Translator,
	turns: readonly ExportTurn[],
	selectedEvent: { id: string; label: string } | null,
): CutOption[] {
	const out: CutOption[] = turns.map((turn) => ({
		value: `turn:${turn.n}`,
		cut: { kind: "turn", turn: turn.n },
		label: t("sessionInsights.export.cutTurn", { n: turn.n, label: turn.label }),
	}));
	if (selectedEvent)
		out.push({
			value: `event:${selectedEvent.id}`,
			cut: { kind: "event", eventId: selectedEvent.id },
			label: t("sessionInsights.export.cutEvent", { label: selectedEvent.label }),
		});
	return out;
}

/** The options: the fixture's cut and name, the labels switch, the masking notice and the progress. */
export function ExportOptions({
	kind,
	cuts,
	cut,
	onCut,
	name,
	onName,
	includeLabels,
	onIncludeLabels,
	running,
}: {
	kind: ExportKind;
	cuts: readonly CutOption[];
	cut: string;
	onCut: (value: string) => void;
	name: string;
	onName: (value: string) => void;
	includeLabels: boolean;
	onIncludeLabels: (value: boolean) => void;
	running: boolean;
}) {
	const t = useT();
	const locale = localeOf(t);
	const labelsId = useId();
	const cutId = useId();
	const nameId = useId();
	return (
		<div className="flex flex-col gap-12">
			{kind === "fixture" ? (
				<>
					<div className="flex flex-col gap-4">
						<label htmlFor={cutId} className="tr-text-metadata text-text-muted">
							{t("sessionInsights.export.cut")}
						</label>
						{cuts.length > 0 ? (
							<select
								id={cutId}
								data-testid="session-insights-export-cut"
								value={cut}
								disabled={running}
								onChange={(event) => onCut(event.currentTarget.value)}
								className={FIELD}
							>
								{cuts.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						) : (
							<span id={cutId} className="tr-text-metadata text-text-subtle">
								{t("sessionInsights.export.cutDefault")}
							</span>
						)}
					</div>
					<div className="flex flex-col gap-4">
						<label htmlFor={nameId} className="tr-text-metadata text-text-muted">
							{t("sessionInsights.export.name")}
						</label>
						<input
							id={nameId}
							type="text"
							data-testid="session-insights-export-name"
							value={name}
							maxLength={NAME_CHARS}
							disabled={running}
							placeholder={t("sessionInsights.export.namePlaceholder")}
							onChange={(event) => onName(event.currentTarget.value)}
							className={FIELD}
						/>
						<span className="tr-text-metadata text-text-subtle">
							{t("sessionInsights.export.snapshotRule", {
								files: formatCount(locale, SNAPSHOT.files),
								size: formatBytes(locale, SNAPSHOT.bytes),
							})}
						</span>
					</div>
				</>
			) : null}
			<label
				htmlFor={labelsId}
				className="flex cursor-pointer items-center gap-8 tr-text-ui text-text-default"
			>
				<input
					id={labelsId}
					type="checkbox"
					data-testid="session-insights-export-labels"
					checked={includeLabels}
					disabled={running}
					onChange={(event) => onIncludeLabels(event.currentTarget.checked)}
					className="size-14 shrink-0 accent-primary"
				/>
				{t("sessionInsights.export.includeLabels")}
			</label>
			<p
				data-testid="session-insights-export-masking"
				className="rounded-sm border border-feedback-warning-muted bg-feedback-warning-subtle px-8 py-4 tr-text-metadata text-text-default"
			>
				{t("sessionInsights.export.masking")}
			</p>
			{running ? (
				<span
					data-testid="session-insights-export-progress"
					className="flex items-center gap-8 tr-text-metadata text-text-muted"
				>
					<progress
						aria-label={t("sessionInsights.export.running")}
						className="h-2 w-96 accent-primary"
					/>
					{t("sessionInsights.export.running")}
				</span>
			) : null}
		</div>
	);
}

/** What came of an export: the written path with its notes, or the coded failure. */
export function ExportOutcome({
	kind,
	phase,
}: {
	kind: ExportKind;
	phase: Extract<ExportPhase, { kind: "done" | "failed" | "broken" }>;
}) {
	const t = useT();
	const locale = localeOf(t);
	if (phase.kind === "done")
		return (
			<div data-testid="session-insights-export-done" className="flex flex-col gap-8">
				<span className="tr-text-metadata text-text-muted">
					{t("sessionInsights.export.written")}
				</span>
				<code
					data-testid="session-insights-export-path"
					className="wrap-anywhere rounded-sm border border-border-default bg-control-bg px-8 py-4 tr-code-text-small"
				>
					{phase.result.path}
				</code>
				<span className="tr-text-metadata text-text-subtle">
					{t("sessionInsights.export.size", {
						files: formatCount(locale, phase.result.files),
						size: formatBytes(locale, phase.result.bytes),
					})}
				</span>
				{phase.result.notes.length > 0 ? (
					<ul className="flex list-disc flex-col gap-2 pl-16 tr-text-metadata text-text-muted">
						{phase.result.notes.map((note) => (
							<li key={note} data-testid="session-insights-export-note" data-note={note}>
								{t(NOTE_TEXT[note], {
									files: formatCount(locale, SNAPSHOT.files),
									size: formatBytes(locale, SNAPSHOT.bytes),
								})}
							</li>
						))}
					</ul>
				) : null}
				{kind === "trace" ? (
					<span className="tr-text-metadata text-text-muted">
						{t("sessionInsights.export.viewers")}
					</span>
				) : null}
				<span className="tr-text-metadata text-text-subtle">
					{t("sessionInsights.export.bestEffort")}
				</span>
			</div>
		);
	return (
		<div data-testid="session-insights-export-error" role="alert" className="flex flex-col gap-4">
			<span className="tr-text-ui text-feedback-error">
				{phase.kind === "failed"
					? t(ERROR_TEXT[phase.result.code], {
							found: phase.result.found.map((item) => t(FINDING_TEXT[item])).join(", "),
							detail: phase.result.detail,
						})
					: phase.version
						? t("sessionInsights.updateHost")
						: t("sessionInsights.export.error.failed")}
			</span>
			{phase.kind === "failed" ? (
				<span
					data-testid="session-insights-export-code"
					className="tr-code-text-small text-text-subtle"
				>
					{phase.result.code}
				</span>
			) : null}
		</div>
	);
}

function ExportDialog({
	host,
	sessionId,
	kind,
	turns,
	defaultTurn,
	selectedEvent,
	onClose,
}: {
	host: PanelHost;
	sessionId: string;
	kind: ExportKind;
	turns: readonly ExportTurn[];
	defaultTurn: number | null;
	selectedEvent: { id: string; label: string } | null;
	onClose: () => void;
}) {
	const t = useT();
	const cuts = cutOptions(t, turns, selectedEvent);
	const initial =
		cuts.find((option) => option.cut.kind === "turn" && option.cut.turn === defaultTurn) ??
		cuts.at(turns.length - 1);
	const [includeLabels, setIncludeLabels] = useState(false);
	const [cut, setCut] = useState(initial?.value ?? "");
	const [name, setName] = useState("");
	const [phase, setPhase] = useState<ExportPhase>({ kind: "options" });
	const start = () => {
		setPhase({ kind: "running" });
		const chosen = cuts.find((option) => option.value === cut)?.cut;
		runExport(host, {
			kind,
			sessionId,
			includeLabels,
			...(chosen ? { cut: chosen } : {}),
			...(name.trim() ? { name: name.trim() } : {}),
		}).then(
			(result) => setPhase(result.ok ? { kind: "done", result } : { kind: "failed", result }),
			(error: unknown) => setPhase({ kind: "broken", version: error instanceof VersionSkew }),
		);
	};
	const Icon = KIND_ICON[kind];
	return (
		<DialogContent
			data-testid="session-insights-export-dialog"
			data-kind={kind}
			className="max-w-[32rem]"
		>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-8">
					<Icon aria-hidden className="size-16 shrink-0 text-text-muted" />
					{t(KIND_TITLE[kind])}
				</DialogTitle>
				<DialogDescription>{t(KIND_ABOUT[kind])}</DialogDescription>
			</DialogHeader>
			{phase.kind === "options" || phase.kind === "running" ? (
				<ExportOptions
					kind={kind}
					cuts={cuts}
					cut={cut}
					onCut={setCut}
					name={name}
					onName={setName}
					includeLabels={includeLabels}
					onIncludeLabels={setIncludeLabels}
					running={phase.kind === "running"}
				/>
			) : (
				<ExportOutcome kind={kind} phase={phase} />
			)}
			<DialogFooter>
				{phase.kind === "done" && host.openArtifacts ? (
					<Button
						variant="outline"
						size="m"
						iconLeft={RiFolderOpenLine}
						data-testid="session-insights-export-open"
						onClick={() => {
							host.openArtifacts?.();
							onClose();
						}}
					>
						{t("sessionInsights.export.openArtifacts")}
					</Button>
				) : null}
				{phase.kind === "failed" || phase.kind === "broken" ? (
					<Button variant="outline" size="m" onClick={() => setPhase({ kind: "options" })}>
						{t("common.retry")}
					</Button>
				) : null}
				{phase.kind === "options" || phase.kind === "running" ? (
					<>
						<Button variant="ghost" size="m" disabled={phase.kind === "running"} onClick={onClose}>
							{t("common.cancel")}
						</Button>
						<Button
							variant="primary"
							size="m"
							data-testid="session-insights-export-run"
							loading={phase.kind === "running"}
							onClick={start}
						>
							{t("sessionInsights.export.run")}
						</Button>
					</>
				) : (
					<Button
						variant="primary"
						size="m"
						data-testid="session-insights-export-close"
						onClick={onClose}
					>
						{t("common.close")}
					</Button>
				)}
			</DialogFooter>
		</DialogContent>
	);
}

export const EXPORT_KINDS: readonly ExportKind[] = ["html", "trace", "fixture"];

/** An export the user picked: its kind, and a count that gives every pick a fresh dialog. */
export interface ExportRequest {
	kind: ExportKind;
	attempt: number;
}

export interface ExportTarget {
	turns: readonly ExportTurn[];
	defaultTurn: number | null;
	selectedEvent: { id: string; label: string } | null;
}

/** An export kind's icon and name, as the menu lists it. */
export function ExportKindLabel({ kind }: { kind: ExportKind }) {
	const t = useT();
	const Icon = KIND_ICON[kind];
	return (
		<>
			<Icon aria-hidden className="size-14 shrink-0" />
			{t(KIND_ITEM[kind])}
		</>
	);
}

/** The session header's Export button: its menu picks HTML, Chrome trace or e2e fixture. */
export function ExportTrigger({ onPick }: { onPick: (kind: ExportKind) => void }) {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="s"
					iconLeft={RiDownload2Line}
					iconRight={RiArrowDownSLine}
					data-testid="session-insights-export"
				>
					{t("sessionInsights.export.menu")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{EXPORT_KINDS.map((item) => (
					<DropdownMenuItem
						key={item}
						data-testid="session-insights-export-item"
						data-kind={item}
						onSelect={() => onPick(item)}
					>
						<ExportKindLabel kind={item} />
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The options dialog of the picked export. */
export function ExportDialogs({
	host,
	sessionId,
	target,
	request,
	onClose,
}: {
	host: PanelHost;
	sessionId: string;
	target: ExportTarget;
	request: ExportRequest | null;
	onClose: () => void;
}) {
	return (
		<Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
			{request ? (
				<ExportDialog
					key={request.attempt}
					host={host}
					sessionId={sessionId}
					kind={request.kind}
					turns={target.turns}
					defaultTurn={target.defaultTurn}
					selectedEvent={target.selectedEvent}
					onClose={onClose}
				/>
			) : null}
		</Dialog>
	);
}
