import {
	RiAlertLine,
	RiCornerDownRightLine,
	RiDownloadLine,
	RiKeyboardLine,
	RiLockLine,
	RiPencilLine,
	RiSearchLine,
	RiUploadLine,
} from "@remixicon/react";
import type { KeybindingOverrides } from "@thinkrail/contracts";
import { i18n, localeOf, type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { webExtensions } from "../extensions";
import {
	actsIn,
	assignChord,
	chordFromEvent,
	chordHolder,
	elementKeyUses,
	globalHolder,
	type ImportPlan,
	type ImportSkipReason,
	isDesktopNativeChord,
	isPlainChord,
	type KeybindingEntry,
	type KeybindingList,
	keybindingsFile,
	keyChordLabel,
	localChordHolder,
	localUses,
	parseChord,
	planImport,
	resetChord,
	SHORTCUT_SURFACE_TITLES,
	SHORTCUT_SURFACES,
	type ShortcutSurface,
} from "../keybindings";
import { SETTINGS_TAG } from "../panels/SettingsGroup";
import { SettingsNotice } from "../panels/SettingsNotice";
import { toast, useAppStore } from "../store";
import { errorText, supportsKeybindings, updateKeybindings } from "../transport";
import { claimKeyboard } from "./extensionCommands";
import { commandTitle, entryTitle, scopeText, useKeybindingList } from "./keybindingState";
import { isDesktopShortcut } from "./shortcutCommands";
import { hasNativeShortcuts } from "./useAppShortcuts";

const CLAIM = "settings.keyboard";
const FILE_NAME = "thinkrail-keybindings.json";
const PRIMARY = "[data-focus-row-primary]";

type Pending =
	| { readonly row: string; readonly kind: "plain" }
	| { readonly row: string; readonly kind: "primitive"; readonly chord: string }
	| { readonly row: string; readonly kind: "desktop"; readonly chord: string }
	| {
			readonly row: string;
			readonly kind: "element";
			readonly chord: string;
			readonly surfaces: readonly ShortcutSurface[];
			readonly scopes: readonly string[];
	  }
	| { readonly row: string; readonly kind: "reserved"; readonly chord: string }
	| {
			readonly row: string;
			readonly kind: "taken";
			readonly chord: string;
			readonly other: string;
			readonly reserved: boolean;
	  }
	| {
			readonly row: string;
			readonly kind: "takenInScope";
			readonly chord: string;
			readonly other: string;
			readonly scope: string;
	  }
	| {
			readonly row: string;
			readonly kind: "shadow";
			readonly chord: string;
			readonly global: string;
			readonly scope: string;
	  }
	| {
			readonly row: string;
			readonly kind: "note";
			readonly chord: string;
			readonly scopes: readonly string[];
	  };

interface Importing {
	readonly plan: ImportPlan;
	readonly name: string;
}

const SKIP_REASONS = {
	locked: "settings.keyboard.import.skip.locked",
	unknown: "settings.keyboard.import.skip.unknown",
	invalid: "settings.keyboard.import.skip.invalid",
	plain: "settings.keyboard.import.skip.plain",
	primitive: "settings.keyboard.import.skip.primitive",
	desktop: "settings.keyboard.import.skip.desktop",
} as const satisfies Record<ImportSkipReason, string>;

function chordName(chord: string, platform: string): string {
	const parsed = parseChord(chord);
	return parsed ? keyChordLabel(parsed, platform) : chord;
}

function saveKeybindings(next: KeybindingOverrides, failure: string): void {
	void updateKeybindings(next).catch((error: unknown) => toast.error(errorText(error), failure));
}

function downloadFile(list: KeybindingList): void {
	const english = i18n.getFixedT("en");
	const file = keybindingsFile(list, (entry) => entryTitle(english, entry));
	const url = URL.createObjectURL(
		new Blob([`${JSON.stringify(file, null, "\t")}\n`], { type: "application/json" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = FILE_NAME;
	link.click();
	URL.revokeObjectURL(url);
}

async function readJson(file: File): Promise<unknown> {
	try {
		return JSON.parse(await file.text());
	} catch {
		return null;
	}
}

function useKeyboardClaim(active: boolean): void {
	useEffect(() => {
		if (!active) return;
		claimKeyboard(CLAIM, true);
		return () => claimKeyboard(CLAIM, false);
	}, [active]);
}

function entryLabels(entry: KeybindingEntry): string[] {
	return [...entry.fixed, ...entry.chords].flatMap(({ label, shown }) => (shown ? [label] : []));
}

function matchesQuery(t: Translator, entry: KeybindingEntry, needle: string): boolean {
	return (
		entryTitle(t, entry).toLocaleLowerCase().includes(needle) ||
		entryLabels(entry).some((label) => label.toLocaleLowerCase().includes(needle))
	);
}

function listOf(t: Translator, items: readonly string[]): string {
	return new Intl.ListFormat(localeOf(t), { type: "conjunction" }).format([...new Set(items)]);
}

function recordingPrompt(entry: KeybindingEntry) {
	if (entry.fixed.length > 0) return "settings.keyboard.editor.recordingAlias" as const;
	return entry.scope === null
		? ("settings.keyboard.editor.recording" as const)
		: ("settings.keyboard.editor.recordingLocal" as const);
}

function FixedChords({ entry }: { entry: KeybindingEntry }) {
	const t = useT();
	if (entry.fixed.length === 0 || entry.locked) return null;
	return (
		<span
			data-testid="keybinding-fixed"
			className="flex shrink-0 items-center gap-4 tr-text-metadata text-text-subtle"
		>
			{entry.fixed.map((chord) => (
				<Keycaps key={chord.text} keys={chord.keys} className="whitespace-nowrap" />
			))}
			<RiLockLine aria-hidden className="size-12" />
			{t("settings.keyboard.editor.alwaysWorks")}
			<span aria-hidden>·</span>
		</span>
	);
}

function EntryChords({ entry, recording }: { entry: KeybindingEntry; recording: boolean }) {
	const t = useT();
	if (recording) {
		return <span className="tr-text-metadata text-primary">{t(recordingPrompt(entry))}</span>;
	}
	const shown = [...(entry.locked ? entry.fixed : []), ...entry.chords].filter(
		(chord) => chord.shown,
	);
	if (shown.length === 0) {
		return (
			<span className="tr-text-metadata text-text-subtle">
				{t("settings.keyboard.editor.unbound")}
			</span>
		);
	}
	return (
		<>
			{shown.map((chord) => (
				<span key={chord.text} className="flex items-center gap-4">
					<Keycaps
						keys={chord.keys}
						className={cn(
							"whitespace-nowrap",
							chord.lostTo !== null && "[&_kbd]:text-text-subtle [&_kbd]:line-through",
						)}
					/>
					{chord.displayOnly ? (
						<RiLockLine aria-hidden className="size-12 text-text-subtle" />
					) : null}
				</span>
			))}
			{entry.locked ? (
				<>
					<RiLockLine aria-hidden className="size-14 text-text-subtle" />
					<span className="sr-only">{t("settings.keyboard.editor.locked")}</span>
				</>
			) : null}
			{entry.fixed.length > 0 && !entry.locked ? (
				<RiPencilLine aria-hidden className="size-12 text-text-subtle" />
			) : null}
		</>
	);
}

function KeybindingRow({
	entry,
	winner,
	editable,
	recording,
	current,
	dimmed,
	message,
	onRecord,
	onKeyDown,
	onBlur,
	onFocus,
	onReset,
}: {
	entry: KeybindingEntry;
	winner: (command: string) => string;
	editable: boolean;
	recording: boolean;
	current: boolean;
	dimmed: boolean;
	message: ReactNode;
	onRecord: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onBlur: () => void;
	onFocus: () => void;
	onReset: () => void;
}) {
	const t = useT();
	const titleId = useId();
	const chordId = useId();
	const lost = entry.chords.filter((chord) => chord.lostTo !== null);
	const changeable = editable && !entry.locked;
	return (
		<li
			data-testid="keybinding-row"
			data-command={entry.id}
			data-alias={entry.id === entry.command ? undefined : entry.command}
			data-scope={entry.scope ?? undefined}
			data-custom={entry.custom ? "true" : undefined}
			data-locked={entry.locked ? "true" : undefined}
			data-focus-row={entry.id}
			className={cn("flex flex-col gap-4 rounded-sm px-8 py-4", recording && "bg-primary-subtle")}
		>
			<div className="flex items-center gap-12">
				<div className="flex min-w-0 flex-1 flex-col items-start gap-2">
					<span className="flex flex-wrap items-center gap-8">
						<span
							id={titleId}
							className={cn("tr-text-ui", dimmed ? "text-text-muted" : "text-text-default")}
						>
							{entryTitle(t, entry)}
						</span>
						{entry.custom ? (
							<span data-testid="keybinding-custom" className={cn(SETTINGS_TAG, "text-primary")}>
								{t("settings.keyboard.editor.custom")}
							</span>
						) : null}
					</span>
					{lost.map((chord) => (
						<span
							key={chord.text}
							data-testid="keybinding-conflict"
							className="flex items-center gap-4 tr-text-metadata text-feedback-warning"
						>
							<RiAlertLine aria-hidden className="size-14 shrink-0" />
							{t("settings.keyboard.editor.conflict", {
								chord: chord.label,
								winner: winner(chord.lostTo ?? ""),
							})}
						</span>
					))}
					{entry.yields.map((use) => (
						<span
							key={`${use.scope}:${use.label}`}
							data-testid="keybinding-yields"
							className="flex items-center gap-4 tr-text-metadata text-text-muted"
						>
							<RiCornerDownRightLine aria-hidden className="size-14 shrink-0" />
							{t("settings.keyboard.editor.yields", {
								inside: scopeText(t, use.scope, "inside"),
								chord: use.label,
								command: winner(use.winner),
							})}
						</span>
					))}
					{lost.length > 0 && changeable ? (
						<Button
							variant="outline"
							size="s"
							data-testid="keybinding-assign-another"
							tabIndex={current ? 0 : -1}
							onClick={onRecord}
						>
							{t("settings.keyboard.editor.assignAnother")}
						</Button>
					) : null}
				</div>
				<FixedChords entry={entry} />
				<button
					id={chordId}
					type="button"
					data-testid="keybinding-chord"
					data-focus-row-primary
					data-settings-draft-input={recording ? "" : undefined}
					aria-labelledby={`${titleId} ${chordId}`}
					aria-disabled={changeable ? undefined : true}
					tabIndex={current ? 0 : -1}
					onClick={changeable ? onRecord : undefined}
					onKeyDown={onKeyDown}
					onFocus={onFocus}
					onBlur={onBlur}
					className={cn(
						"flex min-h-24 shrink-0 flex-wrap items-center justify-end gap-x-8 gap-y-4 rounded-xs px-4 focus-visible:focus-ring",
						changeable && "hover:bg-control-bg-hovered",
					)}
				>
					<EntryChords entry={entry} recording={recording} />
				</button>
				<span className="flex w-64 shrink-0 justify-end">
					{entry.custom && changeable ? (
						<Button
							variant="ghost"
							size="s"
							data-testid="keybinding-reset"
							tabIndex={current ? 0 : -1}
							onClick={onReset}
						>
							{t("settings.keyboard.editor.reset")}
						</Button>
					) : null}
				</span>
			</div>
			{message}
		</li>
	);
}

function PendingNotice({
	pending,
	list,
	onAccept,
	onCancel,
}: {
	pending: Pending;
	list: KeybindingList;
	onAccept: (chord: string, replace: string | null) => void;
	onCancel: () => void;
}) {
	const t = useT();
	const { platform } = list.keybindings;
	const cancel = (
		<Button variant="outline" size="s" data-testid="keybinding-cancel" onClick={onCancel}>
			{t("common.cancel")}
		</Button>
	);
	const dismiss = (
		<Button variant="outline" size="s" data-testid="keybinding-dismiss" onClick={onCancel}>
			{t("common.dismiss")}
		</Button>
	);
	const assign = (chord: string) => (
		<Button
			variant="outline"
			size="s"
			data-testid="keybinding-assign-anyway"
			onClick={() => onAccept(chord, null)}
		>
			{t("settings.keyboard.editor.assignAnyway")}
		</Button>
	);
	const replace = (chord: string, other: string) => (
		<>
			<Button
				variant="outline"
				size="s"
				data-testid="keybinding-replace"
				onClick={() => onAccept(chord, other)}
			>
				{t("settings.keyboard.editor.replace")}
			</Button>
			{cancel}
		</>
	);
	let text: string;
	let action: ReactNode;
	if (pending.kind === "plain") {
		text = t("settings.keyboard.editor.plain");
		action = dismiss;
	} else if (pending.kind === "primitive") {
		text = t("settings.keyboard.editor.primitive", { chord: chordName(pending.chord, platform) });
		action = dismiss;
	} else if (pending.kind === "note") {
		text = t("settings.keyboard.editor.otherScopes", {
			chord: chordName(pending.chord, platform),
			places: listOf(
				t,
				pending.scopes.map((scope) => scopeText(t, scope, "inside")),
			),
			count: pending.scopes.length,
		});
		action = dismiss;
	} else if (pending.kind === "takenInScope") {
		text = t("settings.keyboard.editor.takenInScope", {
			chord: chordName(pending.chord, platform),
			command: holderTitle(t, list, pending.other, pending.scope),
			inside: scopeText(t, pending.scope, "inside"),
		});
		action = replace(pending.chord, pending.other);
	} else if (pending.kind === "shadow") {
		const parsed = parseChord(pending.chord);
		text = t(
			parsed && isPlainChord(parsed)
				? "settings.keyboard.editor.shadowPlain"
				: "settings.keyboard.editor.shadow",
			{
				chord: chordName(pending.chord, platform),
				global: commandTitle(t, list, pending.global),
				inside: scopeText(t, pending.scope, "inside"),
				local: commandTitle(t, list, pending.row),
			},
		);
		action = (
			<>
				{assign(pending.chord)}
				{cancel}
			</>
		);
	} else if (pending.kind === "desktop") {
		text = t("settings.keyboard.editor.desktopNative", {
			chord: chordName(pending.chord, platform),
		});
		action = dismiss;
	} else if (pending.kind === "element") {
		text = t("settings.keyboard.editor.elementKey", {
			key: chordName(pending.chord, platform),
			places: listOf(t, [
				...pending.scopes.map((scope) => scopeText(t, scope, "inside")),
				...pending.surfaces.map((surface) => t(SHORTCUT_SURFACE_TITLES[surface])),
			]),
		});
		action = (
			<>
				{assign(pending.chord)}
				{cancel}
			</>
		);
	} else if (pending.kind === "reserved") {
		text = t("settings.keyboard.editor.browserReserved", {
			chord: chordName(pending.chord, platform),
		});
		action = (
			<>
				{assign(pending.chord)}
				{cancel}
			</>
		);
	} else {
		text = t(
			pending.reserved
				? "settings.keyboard.editor.takenReserved"
				: "settings.keyboard.editor.taken",
			{
				chord: chordName(pending.chord, platform),
				command: commandTitle(t, list, pending.other),
			},
		);
		action = replace(pending.chord, pending.other);
	}
	const variant =
		pending.kind === "plain" || pending.kind === "desktop" || pending.kind === "primitive"
			? "error"
			: pending.kind === "note"
				? "info"
				: "warning";
	return (
		<div role="alert" data-testid="keybinding-message" data-kind={pending.kind}>
			<SettingsNotice variant={variant} action={action}>
				{text}
			</SettingsNotice>
		</div>
	);
}

function holderTitle(t: Translator, list: KeybindingList, holder: string, scope: string): string {
	const alias = list.entries.find(
		(entry) => entry.command === holder && entry.scope === scope && entry.id !== entry.command,
	);
	return alias
		? t("settings.keyboard.editor.alias", { command: entryTitle(t, alias) })
		: commandTitle(t, list, holder);
}

function ImportGroup({
	title,
	testId,
	items,
}: {
	title: string;
	testId: string;
	items: readonly { key: string; text: string }[];
}) {
	const t = useT();
	return (
		<section data-testid={testId} className="flex flex-col gap-4">
			<h3 className="tr-text-eyebrow text-text-muted">{title}</h3>
			{items.length === 0 ? (
				<p className="tr-text-metadata text-text-subtle">{t("settings.keyboard.import.none")}</p>
			) : (
				<ul className="flex list-disc flex-col gap-2 pl-16 tr-text-ui text-text-default">
					{items.map((item) => (
						<li key={item.key}>{item.text}</li>
					))}
				</ul>
			)}
		</section>
	);
}

function ImportSummary({
	importing,
	list,
	onClose,
}: {
	importing: Importing;
	list: KeybindingList;
	onClose: () => void;
}) {
	const t = useT();
	const { plan, name } = importing;
	const chords = (labels: readonly string[]) =>
		labels.length === 0 ? t("settings.keyboard.editor.unbound") : labels.join(", ");
	const count = plan.changes.length;
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent
				data-testid="keybinding-import-dialog"
				aria-describedby={undefined}
				hideClose
				className="max-h-[84vh] max-w-[40rem]"
			>
				<DialogHeader>
					<DialogTitle>{t("settings.keyboard.import.title", { name })}</DialogTitle>
				</DialogHeader>
				<div className="flex min-h-0 flex-col gap-12 overflow-y-auto">
					<ImportGroup
						testId="keybinding-import-changes"
						title={t("settings.keyboard.import.changes", { count })}
						items={plan.changes.map((change) => ({
							key: change.command,
							text: t("settings.keyboard.import.changeLine", {
								command: commandTitle(t, list, change.command),
								from: chords(change.from),
								to: chords(change.to),
							}),
						}))}
					/>
					<ImportGroup
						testId="keybinding-import-conflicts"
						title={t("settings.keyboard.import.conflicts", { count: plan.conflicts.length })}
						items={plan.conflicts.map((conflict) => ({
							key: `${conflict.chord}:${conflict.command}:${conflict.other}`,
							text:
								conflict.scope === null
									? t("settings.keyboard.import.conflictLine", {
											chord: conflict.chord,
											command: commandTitle(t, list, conflict.command),
											other: commandTitle(t, list, conflict.other),
										})
									: t("settings.keyboard.import.conflictLineScoped", {
											chord: conflict.chord,
											inside: scopeText(t, conflict.scope, "inside"),
											command: commandTitle(t, list, conflict.command),
											other: holderTitle(t, list, conflict.other, conflict.scope),
										}),
						}))}
					/>
					<ImportGroup
						testId="keybinding-import-skipped"
						title={t("settings.keyboard.import.skipped", { count: plan.skipped.length })}
						items={plan.skipped.map((skip, index) => ({
							key: `${index}:${skip.command}`,
							text: t("settings.keyboard.import.skipLine", {
								command:
									skip.command === ""
										? t("settings.keyboard.import.unnamed")
										: commandTitle(t, list, skip.command),
								reason: t(SKIP_REASONS[skip.reason]),
							}),
						}))}
					/>
					<p data-testid="keybinding-import-unchanged" className="tr-text-metadata text-text-muted">
						{t("settings.keyboard.import.unchanged", { count: plan.unchanged })}
					</p>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						data-testid="keybinding-import-apply"
						disabled={count === 0}
						onClick={() => {
							saveKeybindings(plan.overrides, t("settings.keyboard.editor.saveFailed"));
							onClose();
						}}
					>
						{t("settings.keyboard.import.apply", { count })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function scopeGroups(
	rows: readonly KeybindingEntry[],
): { scope: string | null; rows: KeybindingEntry[] }[] {
	const groups: { scope: string | null; rows: KeybindingEntry[] }[] = [];
	for (const entry of rows) {
		const last = groups.at(-1);
		if (last && last.scope === entry.scope) last.rows.push(entry);
		else groups.push({ scope: entry.scope, rows: [entry] });
	}
	return groups;
}

export function KeybindingEditor() {
	const t = useT();
	const [desktop] = useState(hasNativeShortcuts);
	const list = useKeybindingList(desktop);
	const { platform } = list.keybindings;
	const overrides = useAppStore((state) => state.keybindingOverrides);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const editable = supportsKeybindings(useAppStore((state) => state.protocolVersion));
	const [query, setQuery] = useState("");
	const [keysMode, setKeysMode] = useState(false);
	const [keyFilter, setKeyFilter] = useState<string | null>(null);
	const [filterFocused, setFilterFocused] = useState(false);
	const [recording, setRecording] = useState<string | null>(null);
	const [pending, setPending] = useState<Pending | null>(null);
	const [current, setCurrent] = useState<string | null>(null);
	const [importing, setImporting] = useState<Importing | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const filterInput = useRef<HTMLInputElement>(null);
	useKeyboardClaim(recording !== null || (keysMode && filterFocused));

	const failure = t("settings.keyboard.editor.saveFailed");
	const needle = query.trim().toLocaleLowerCase();
	const keyLabel = keyFilter === null ? null : chordName(keyFilter, platform);
	const shown = list.entries.filter((entry) =>
		keyLabel !== null
			? entryLabels(entry).includes(keyLabel)
			: needle === "" || matchesQuery(t, entry, needle),
	);
	const filtering = keyLabel !== null || needle !== "";
	const tabStop = shown.some((entry) => entry.id === current) ? current : (shown[0]?.id ?? null);
	const sections = [
		...SHORTCUT_SURFACES.map((surface) => ({
			key: surface,
			title: t(SHORTCUT_SURFACE_TITLES[surface]),
			extension: false,
			enabled: true,
			rows: shown.filter((entry) => entry.surface === surface),
		})),
		...webExtensions.map(({ name, title }) => ({
			key: name,
			title: title ? t(title) : name,
			extension: true,
			enabled: !disabled.includes(name),
			rows: shown.filter((entry) => entry.surface === null && entry.source === name),
		})),
	]
		.filter((section) => section.rows.length > 0)
		.map((section) => ({ ...section, groups: scopeGroups(section.rows) }));

	const focusRow = (row: string) => {
		root.current
			?.querySelector<HTMLElement>(`[data-focus-row="${CSS.escape(row)}"] ${PRIMARY}`)
			?.focus();
	};
	const settle = (next: Pending) => {
		setRecording(null);
		setPending(next);
	};
	const startRecording = (row: string) => {
		setPending(null);
		setRecording(row);
		focusRow(row);
	};
	const finish = (row: string, next: KeybindingOverrides | null, after: Pending | null = null) => {
		if (next !== null) saveKeybindings(next, failure);
		setPending(after);
		setRecording(null);
		focusRow(row);
	};
	const assignLocal = (entry: KeybindingEntry, chord: string, replace: string | null = null) => {
		const scope = list.keybindings.byId.get(entry.command)?.scope ?? null;
		const own = scope === null ? [] : actsIn(list.keybindings, scope);
		const elsewhere = localUses(list.keybindings, chord).flatMap((use) =>
			own.includes(use.scope) ? [] : [use.scope],
		);
		const note: Pending | null =
			elsewhere.length === 0 ? null : { row: entry.id, kind: "note", chord, scopes: elsewhere };
		finish(entry.id, assignChord(list, overrides, entry.command, chord, replace), note);
	};

	const recordLocal = (entry: KeybindingEntry, chord: string, reserved: boolean) => {
		const row = entry.id;
		const holder = localChordHolder(list, entry.command, chord);
		if (holder?.scope) {
			return settle({
				row,
				kind: "takenInScope",
				chord,
				other: holder.command,
				scope: holder.scope,
			});
		}
		const global = globalHolder(list.keybindings, chord);
		const scope = list.keybindings.byId.get(entry.command)?.scope ?? null;
		if (global !== null && scope !== null) {
			return settle({ row, kind: "shadow", chord, global, scope });
		}
		if (reserved) return settle({ row, kind: "reserved", chord });
		assignLocal(entry, chord);
	};

	const record = (entry: KeybindingEntry, event: KeyboardEvent<HTMLButtonElement>) => {
		if (isImeComposing(event.nativeEvent) || event.key === "Tab") return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === "Escape" && !event.shiftKey) {
			setRecording(null);
			return;
		}
		if (event.repeat) return;
		const recorded = chordFromEvent(event.nativeEvent, platform, { allowPlain: entry.plain });
		if (recorded.kind === "ignored") return;
		const { id: row, command } = entry;
		if (recorded.kind === "rejected") {
			if (recorded.reason === "plain") settle({ row, kind: "plain" });
			else if (recorded.reason === "locked" && entry.defaults.includes(recorded.chord)) {
				finish(row, assignChord(list, overrides, command, recorded.chord));
			} else if (recorded.reason === "locked") {
				settle({ row, kind: "primitive", chord: recorded.chord });
			}
			return;
		}
		const { chord } = recorded;
		const reserved = recorded.browserReserved && !desktop;
		if (isDesktopNativeChord(chord) || isDesktopShortcut(event.nativeEvent)) {
			return settle({ row, kind: "desktop", chord });
		}
		if (entry.scope !== null) return recordLocal(entry, chord, reserved);
		const other = chordHolder(list, command, chord);
		if (other !== null) return settle({ row, kind: "taken", chord, other, reserved });
		const scopes = localUses(list.keybindings, chord).map((use) => use.scope);
		const surfaces = entry.plain ? elementKeyUses(event, platform).map((use) => use.surface) : [];
		if (scopes.length > 0 || surfaces.length > 0) {
			return settle({ row, kind: "element", chord, surfaces, scopes });
		}
		if (reserved) return settle({ row, kind: "reserved", chord });
		finish(row, assignChord(list, overrides, command, chord));
	};

	const onRowKeyDown = (entry: KeybindingEntry, event: KeyboardEvent<HTMLButtonElement>) => {
		if (recording === entry.id) {
			record(entry, event);
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		event.preventDefault();
		const buttons = [...(root.current?.querySelectorAll<HTMLElement>(PRIMARY) ?? [])];
		const index = buttons.indexOf(event.currentTarget);
		buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
	};

	const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (!keysMode || isImeComposing(event.nativeEvent) || event.key === "Tab") return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === "Escape") {
			setKeysMode(false);
			setKeyFilter(null);
			return;
		}
		const recorded = chordFromEvent(event.nativeEvent, platform, {
			allowPlain: true,
			allowLocked: true,
		});
		if (recorded.kind === "chord") setKeyFilter(recorded.chord);
	};

	const readFile = (file: File) =>
		readJson(file).then((parsed) => {
			const plan = planImport(overrides, list, parsed);
			if (plan === null) toast.error(t("settings.keyboard.editor.notAFile"));
			else setImporting({ plan, name: file.name });
		});

	const winner = (command: string) => commandTitle(t, list, command);

	return (
		<div ref={root} data-testid="keybinding-editor" className="flex flex-col gap-12">
			<p className="tr-text-metadata text-text-muted">{t("settings.keyboard.editor.intro")}</p>
			{editable ? null : (
				<SettingsNotice variant="info" testId="keybinding-read-only">
					{t("settings.keyboard.editor.olderHost")}
				</SettingsNotice>
			)}
			<div className="flex flex-wrap items-center gap-8">
				<div className="relative min-w-[14rem] flex-1">
					<RiSearchLine
						aria-hidden
						className="pointer-events-none absolute top-1/2 left-8 size-14 -translate-y-1/2 text-text-muted"
					/>
					<input
						ref={filterInput}
						type="text"
						value={keysMode ? (keyLabel ?? "") : query}
						readOnly={keysMode}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onFilterKeyDown}
						onFocus={() => setFilterFocused(true)}
						onBlur={() => setFilterFocused(false)}
						placeholder={
							keysMode
								? t("settings.keyboard.editor.keysPlaceholder")
								: t("shortcuts.filterPlaceholder")
						}
						aria-label={t("shortcuts.filter")}
						data-testid="keybinding-filter"
						data-settings-draft-input={keysMode ? "" : undefined}
						className="h-32 w-full rounded-sm border border-control-border-default bg-control-bg pr-8 pl-24 tr-text-ui text-text-default transition-colors placeholder:text-text-muted focus:border-control-border-active focus-visible:focus-ring"
					/>
				</div>
				<Button
					variant={keysMode ? "soft-primary" : "outline"}
					size="m"
					iconLeft={RiKeyboardLine}
					aria-pressed={keysMode}
					data-testid="keybinding-search-keys"
					onClick={() => {
						setKeysMode(!keysMode);
						setKeyFilter(null);
						setQuery("");
						filterInput.current?.focus();
					}}
				>
					{t("settings.keyboard.editor.searchByKeys")}
				</Button>
				{editable ? (
					<Button
						variant="outline"
						size="m"
						data-testid="keybinding-reset-all"
						disabled={Object.keys(overrides).length === 0}
						onClick={() => saveKeybindings({}, failure)}
					>
						{t("settings.keyboard.editor.resetAll")}
					</Button>
				) : null}
				<Button
					variant="outline"
					size="m"
					iconLeft={RiDownloadLine}
					data-testid="keybinding-export"
					onClick={() => downloadFile(list)}
				>
					{t("settings.keyboard.editor.export")}
				</Button>
				{editable ? (
					<>
						<Button
							variant="outline"
							size="m"
							iconLeft={RiUploadLine}
							data-testid="keybinding-import"
							onClick={() => fileInput.current?.click()}
						>
							{t("settings.keyboard.editor.import")}
						</Button>
						<input
							ref={fileInput}
							type="file"
							accept="application/json,.json"
							data-testid="keybinding-import-input"
							className="sr-only"
							tabIndex={-1}
							onChange={(event) => {
								const [file] = event.currentTarget.files ?? [];
								event.currentTarget.value = "";
								if (file) void readFile(file);
							}}
						/>
					</>
				) : null}
				<span data-testid="keybinding-count" className="tr-text-metadata text-text-muted">
					{filtering
						? t("shortcuts.countFiltered", { shown: shown.length, total: list.entries.length })
						: t("shortcuts.count", { count: list.entries.length })}
				</span>
			</div>
			{sections.length === 0 ? (
				<p className="tr-text-metadata text-text-muted">{t("shortcuts.noMatch")}</p>
			) : (
				<div data-focus-list="keybindings" className="flex flex-col gap-16">
					{sections.map((section) => (
						<section
							key={section.key}
							data-testid="keybinding-section"
							data-section={section.key}
							data-enabled={section.enabled ? "true" : "false"}
							className="flex flex-col gap-4"
						>
							<h5 className="flex items-center gap-8 tr-text-eyebrow text-text-muted">
								{section.title}
								{section.extension ? (
									<span className={cn(SETTINGS_TAG, "text-text-muted")}>
										{t("settings.keyboard.editor.extension")}
									</span>
								) : null}
								{section.enabled ? null : (
									<span className={cn(SETTINGS_TAG, "text-text-muted")}>{t("common.off")}</span>
								)}
							</h5>
							{section.groups.map((group) => (
								<div key={`${group.scope}:${group.rows[0]?.id}`} className="flex flex-col">
									{group.scope === null ? null : (
										<p
											data-testid="keybinding-scope"
											data-scope={group.scope}
											className="flex items-center gap-8 px-8 pt-4 tr-text-metadata text-text-muted"
										>
											<span className={cn(SETTINGS_TAG, "text-text-muted")}>
												{t("settings.keyboard.editor.local")}
											</span>
											{scopeText(t, group.scope, "where")}
										</p>
									)}
									<ul className="flex flex-col">
										{group.rows.map((entry) => (
											<KeybindingRow
												key={entry.id}
												entry={entry}
												winner={winner}
												editable={editable}
												recording={recording === entry.id}
												current={tabStop === entry.id}
												dimmed={!section.enabled}
												onFocus={() => setCurrent(entry.id)}
												onRecord={() => startRecording(entry.id)}
												onKeyDown={(event) => onRowKeyDown(entry, event)}
												onBlur={() => {
													if (recording === entry.id) setRecording(null);
												}}
												onReset={() => finish(entry.id, resetChord(overrides, entry.command))}
												message={
													pending?.row === entry.id ? (
														<PendingNotice
															pending={pending}
															list={list}
															onAccept={(chord, replace) =>
																entry.scope === null
																	? finish(
																			entry.id,
																			assignChord(list, overrides, entry.command, chord, replace),
																		)
																	: assignLocal(entry, chord, replace)
															}
															onCancel={() => finish(entry.id, null)}
														/>
													) : null
												}
											/>
										))}
									</ul>
								</div>
							))}
						</section>
					))}
				</div>
			)}
			{importing ? (
				<ImportSummary importing={importing} list={list} onClose={() => setImporting(null)} />
			) : null}
		</div>
	);
}
