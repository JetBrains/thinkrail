import { RiDownloadLine, RiKeyboardLine, RiSearchLine, RiUploadLine } from "@remixicon/react";
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
import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { webExtensions } from "../extensions";
import {
	actsIn,
	assignChord,
	type ChordHolder,
	chordFromEvent,
	chordHolders,
	elementKeyUses,
	globalHolder,
	type ImportPlan,
	type ImportSkipReason,
	isDesktopNativeChord,
	isPlainChord,
	type KeybindingEntry,
	type KeybindingList,
	keybindingsFile,
	localUses,
	parseChord,
	planImport,
	resetChord,
	SHORTCUT_SURFACE_TITLES,
	type ShortcutSurface,
} from "../keybindings";
import { ConfirmDialog } from "../panels/ConfirmDialog";
import { SETTING } from "../panels/settingsCatalog";
import { Tree } from "../panels/treeNavigation";
import {
	SETTINGS_ROWS,
	SettingsLine,
	SettingsNotice,
	SettingsRow,
	useSettingsJump,
} from "../settingsKit";
import { toast, useAppStore } from "../store";
import { errorText, supportsKeybindings, updateKeybindings } from "../transport";
import { claimKeyboard } from "./extensionCommands";
import { KeybindingAreaRow, KeybindingScopeCaption, KeybindingShortcutRow } from "./KeybindingTree";
import {
	areaOfSetting,
	chordName,
	type KeybindingArea,
	keybindingAreas,
	resetArea,
	scopeRuns,
} from "./keybindingAreas";
import { commandTitle, entryTitle, scopeText, useKeybindingList } from "./keybindingState";
import { isDesktopShortcut } from "./shortcutCommands";
import { hasNativeShortcuts } from "./useAppShortcuts";

const CLAIM = "settings.keyboard";
const FILE_NAME = "thinkrail-keybindings.json";
const PRIMARY = "[data-focus-row-primary]";
const NO_AREAS: ReadonlySet<string> = new Set();

export const EXTENSION_AREAS = webExtensions.map(({ name }) => name);

export function areaTitle(t: Translator, area: KeybindingArea): string {
	if (area.surface !== null) return t(SHORTCUT_SURFACE_TITLES[area.surface]);
	const extension = webExtensions.find(({ name }) => name === area.id);
	return extension?.title ? t(extension.title) : area.id;
}

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
			readonly holders: readonly ChordHolder[];
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

function withArea(areas: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
	if (areas.has(id) === present) return areas;
	const next = new Set(areas);
	if (present) next.add(id);
	else next.delete(id);
	return next;
}

function PendingNotice({
	pending,
	list,
	onAccept,
	onCancel,
}: {
	pending: Pending;
	list: KeybindingList;
	onAccept: (chord: string, replace: boolean) => void;
	onCancel: () => void;
}) {
	const t = useT();
	const { platform } = list.keybindings;
	const cancel = (
		<Button
			variant="outline"
			size="s"
			tabIndex={0}
			data-testid="keybinding-cancel"
			onClick={onCancel}
		>
			{t("common.cancel")}
		</Button>
	);
	const dismiss = (
		<Button
			variant="outline"
			size="s"
			tabIndex={0}
			data-testid="keybinding-dismiss"
			onClick={onCancel}
		>
			{t("common.dismiss")}
		</Button>
	);
	const assign = (chord: string) => (
		<Button
			variant="outline"
			size="s"
			tabIndex={0}
			data-testid="keybinding-assign-anyway"
			onClick={() => onAccept(chord, false)}
		>
			{t("settings.keyboard.editor.assignAnyway")}
		</Button>
	);
	const replace = (chord: string) => (
		<>
			<Button
				variant="outline"
				size="s"
				tabIndex={0}
				data-testid="keybinding-replace"
				onClick={() => onAccept(chord, true)}
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
			holders: listOf(
				t,
				pending.holders.map(({ command, scope }) =>
					scope === null
						? commandTitle(t, list, command)
						: t("settings.keyboard.editor.holderInside", {
								command: holderTitle(t, list, command, scope),
								inside: scopeText(t, scope, "inside"),
							}),
				),
			),
			count: pending.holders.length,
		});
		action = replace(pending.chord);
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
		action = replace(pending.chord);
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
					<Button variant="outline" tabIndex={0} onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button
						tabIndex={0}
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

export function KeybindingEditor() {
	const t = useT();
	const [desktop] = useState(hasNativeShortcuts);
	const list = useKeybindingList(desktop);
	const { platform } = list.keybindings;
	const overrides = useAppStore((state) => state.keybindingOverrides);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const editable = supportsKeybindings(useAppStore((state) => state.protocolVersion));
	const areas = keybindingAreas(list, EXTENSION_AREAS);
	const jump = useSettingsJump();
	const jumpArea = areaOfSetting(areas, jump?.id ?? null);
	const jumpSeq = jumpArea === null ? null : (jump?.seq ?? null);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() =>
		jumpArea === null ? NO_AREAS : new Set([jumpArea]),
	);
	const [closedWhileFiltering, setClosedWhileFiltering] = useState(NO_AREAS);
	const [query, setQuery] = useState("");
	const [keysMode, setKeysMode] = useState(false);
	const [keyFilter, setKeyFilter] = useState<string | null>(null);
	const [filterFocused, setFilterFocused] = useState(false);
	const [recording, setRecording] = useState<string | null>(null);
	const [pending, setPending] = useState<Pending | null>(null);
	const [importing, setImporting] = useState<Importing | null>(null);
	const [confirmingReset, setConfirmingReset] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const filterInput = useRef<HTMLInputElement>(null);
	useKeyboardClaim(recording !== null || (keysMode && filterFocused));

	useEffect(() => {
		if (jumpSeq === null || jumpArea === null) return;
		setQuery("");
		setKeysMode(false);
		setKeyFilter(null);
		setExpanded((open) => withArea(open, jumpArea, true));
	}, [jumpSeq, jumpArea]);

	const failure = t("settings.keyboard.editor.saveFailed");
	const needle = query.trim().toLocaleLowerCase();
	const keyLabel = keyFilter === null ? null : chordName(keyFilter, platform);
	const filtering = keyLabel !== null || needle !== "";
	const matches = (entry: KeybindingEntry) =>
		keyLabel !== null
			? entryLabels(entry).includes(keyLabel)
			: needle === "" || matchesQuery(t, entry, needle);
	const visible = areas
		.map((area) => ({ area, rows: area.entries.filter(matches) }))
		.filter(({ rows }) => !filtering || rows.length > 0);
	const shownCount = visible.reduce((total, { rows }) => total + rows.length, 0);
	const isOpen = (id: string) => (filtering ? !closedWhileFiltering.has(id) : expanded.has(id));

	const toggleArea = (id: string) => {
		const open = isOpen(id);
		if (filtering) setClosedWhileFiltering((closed) => withArea(closed, id, open));
		else setExpanded((shown) => withArea(shown, id, !open));
	};
	const filterBy = (nextQuery: string, nextKey: string | null) => {
		setQuery(nextQuery);
		setKeyFilter(nextKey);
		setClosedWhileFiltering(NO_AREAS);
	};
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
	const assignLocal = (entry: KeybindingEntry, chord: string, replace = false) => {
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
		const holders = chordHolders(list, entry.command, chord);
		if (holders.length > 0) return settle({ row, kind: "takenInScope", chord, holders });
		const global = globalHolder(list.keybindings, chord);
		const scope = list.keybindings.byId.get(entry.command)?.scope ?? null;
		if (global !== null && scope !== null) {
			return settle({ row, kind: "shadow", chord, global, scope });
		}
		if (reserved) return settle({ row, kind: "reserved", chord });
		assignLocal(entry, chord);
	};

	const record = (entry: KeybindingEntry, event: KeyboardEvent<HTMLElement>) => {
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
		const [holder] = chordHolders(list, command, chord);
		if (holder !== undefined) {
			return settle({ row, kind: "taken", chord, other: holder.command, reserved });
		}
		const scopes = localUses(list.keybindings, chord).map((use) => use.scope);
		const surfaces = entry.plain ? elementKeyUses(event, platform).map((use) => use.surface) : [];
		if (scopes.length > 0 || surfaces.length > 0) {
			return settle({ row, kind: "element", chord, surfaces, scopes });
		}
		if (reserved) return settle({ row, kind: "reserved", chord });
		finish(row, assignChord(list, overrides, command, chord));
	};

	const onRowKeyDown = (
		entry: KeybindingEntry,
		changeable: boolean,
		event: KeyboardEvent<HTMLElement>,
	) => {
		if (event.target !== event.currentTarget) return;
		if (recording === entry.id) {
			record(entry, event);
			return;
		}
		if (isImeComposing(event.nativeEvent) || event.key !== "Enter") return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		event.preventDefault();
		if (changeable) startRecording(entry.id);
	};

	const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (isImeComposing(event.nativeEvent) || event.key === "Tab") return;
		if (!keysMode) {
			const plain = !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
			if (event.key !== "Escape" || !plain || query === "") return;
			event.preventDefault();
			filterBy("", null);
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.key === "Escape") {
			setKeysMode(false);
			filterBy("", null);
			return;
		}
		const recorded = chordFromEvent(event.nativeEvent, platform, {
			allowPlain: true,
			allowLocked: true,
		});
		if (recorded.kind === "chord") filterBy("", recorded.chord);
	};

	const readFile = (file: File) =>
		readJson(file).then((parsed) => {
			const plan = planImport(overrides, list, parsed);
			if (plan === null) toast.error(t("settings.keyboard.editor.notAFile"));
			else setImporting({ plan, name: file.name });
		});

	const winner = (command: string) => commandTitle(t, list, command);

	const shortcutRow = (entry: KeybindingEntry, enabled: boolean) => {
		const changeable = editable && !entry.locked;
		return (
			<KeybindingShortcutRow
				key={entry.id}
				entry={entry}
				platform={platform}
				winner={winner}
				changeable={changeable}
				recording={recording === entry.id}
				dimmed={!enabled}
				onRecord={() => startRecording(entry.id)}
				onKeyDown={(event) => onRowKeyDown(entry, changeable, event)}
				onBlur={(event) => {
					if (event.target === event.currentTarget && recording === entry.id) setRecording(null);
				}}
				onReset={() => finish(entry.id, resetChord(overrides, entry.command))}
				message={
					pending?.row === entry.id ? (
						<PendingNotice
							pending={pending}
							list={list}
							onAccept={(chord, replace) =>
								entry.scope === null
									? finish(entry.id, assignChord(list, overrides, entry.command, chord, replace))
									: assignLocal(entry, chord, replace)
							}
							onCancel={() => finish(entry.id, null)}
						/>
					) : null
				}
			/>
		);
	};

	return (
		<div ref={root} data-testid="keybinding-editor" className={SETTINGS_ROWS}>
			{editable ? null : (
				<div className="py-8">
					<SettingsNotice variant="info" testId="keybinding-read-only">
						{t("settings.keyboard.editor.olderHost")}
					</SettingsNotice>
				</div>
			)}
			<SettingsLine
				rowId="keyboard-filter"
				className="flex flex-wrap items-center gap-8 border-border-muted border-b py-12"
			>
				<div className="relative min-w-[14rem] flex-1">
					<RiSearchLine
						aria-hidden
						className="pointer-events-none absolute top-1/2 left-8 size-14 -translate-y-1/2 text-text-muted"
					/>
					<input
						ref={filterInput}
						type="text"
						tabIndex={0}
						value={keysMode ? (keyLabel ?? "") : query}
						readOnly={keysMode}
						onChange={(event) => filterBy(event.target.value, null)}
						onKeyDown={onFilterKeyDown}
						onFocus={() => setFilterFocused(true)}
						onBlur={() => setFilterFocused(false)}
						placeholder={
							keysMode
								? t("settings.keyboard.editor.keysPlaceholder")
								: t("settings.keyboard.editor.filterPlaceholder")
						}
						aria-label={t("shortcuts.filter")}
						data-testid="keybinding-filter"
						className="h-32 w-full rounded-sm border border-control-border-default bg-control-bg pr-8 pl-24 tr-text-ui text-text-default transition-colors placeholder:text-text-muted focus:border-control-border-active focus-visible:focus-ring"
					/>
				</div>
				<Button
					variant={keysMode ? "soft-primary" : "outline"}
					size="m"
					iconLeft={RiKeyboardLine}
					tabIndex={0}
					aria-pressed={keysMode}
					data-testid="keybinding-search-keys"
					onClick={() => {
						setKeysMode(!keysMode);
						filterBy("", null);
						filterInput.current?.focus();
					}}
				>
					{t("settings.keyboard.editor.searchByKeys")}
				</Button>
				<span data-testid="keybinding-count" className="tr-text-metadata text-text-muted">
					{filtering
						? t("shortcuts.countFiltered", { shown: shownCount, total: list.entries.length })
						: t("shortcuts.count", { count: list.entries.length })}
				</span>
			</SettingsLine>
			<div
				data-setting-row="keyboard-shortcuts"
				data-setting-id={SETTING.keyboardShortcuts.id}
				className="border-border-muted border-b py-8"
			>
				{visible.length === 0 ? (
					<p className="px-8 py-8 tr-text-metadata text-text-muted">{t("shortcuts.noMatch")}</p>
				) : (
					<Tree
						label={t("settings.keyboard.shortcuts")}
						focusList="keybindings"
						className="flex flex-col"
						leaveAtEdges
					>
						{visible.map(({ area, rows }) => {
							const open = isOpen(area.id);
							const enabled = area.surface !== null || !disabled.includes(area.id);
							const title = areaTitle(t, area);
							return (
								<li
									key={area.id}
									role="none"
									data-testid="keybinding-section"
									data-section={area.id}
									data-enabled={enabled ? "true" : "false"}
									className="flex flex-col"
								>
									<KeybindingAreaRow
										area={area}
										title={title}
										count={
											filtering
												? t("shortcuts.countFiltered", {
														shown: rows.length,
														total: area.entries.length,
													})
												: t("shortcuts.count", { count: area.entries.length })
										}
										expanded={open}
										enabled={enabled}
										resettable={editable}
										onToggle={() => toggleArea(area.id)}
										onReset={() => saveKeybindings(resetArea(overrides, area), failure)}
									/>
									{open ? (
										<ul role="none" className="flex flex-col pl-24">
											{scopeRuns(rows).map((run) => (
												<Fragment key={`${run.scope}:${run.entries[0]?.id}`}>
													{run.scope !== null && area.scope === null ? (
														<li role="none" className="px-8 pt-8 pb-4">
															<KeybindingScopeCaption scope={run.scope} />
														</li>
													) : null}
													{run.entries.map((entry) => shortcutRow(entry, enabled))}
												</Fragment>
											))}
										</ul>
									) : null}
								</li>
							);
						})}
					</Tree>
				)}
			</div>
			<SettingsRow
				rowId="keyboard-import-export"
				label={t("settings.keyboard.editor.importExport")}
				description={t("settings.keyboard.editor.importExportDescription")}
				control={
					<Button
						variant="outline"
						size="m"
						iconLeft={RiDownloadLine}
						tabIndex={0}
						data-testid="keybinding-export"
						onClick={() => downloadFile(list)}
					>
						{t("settings.keyboard.editor.export")}
					</Button>
				}
				sides={
					editable ? (
						<>
							<Button
								variant="outline"
								size="m"
								iconLeft={RiUploadLine}
								tabIndex={0}
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
							<Button
								variant="outline"
								size="m"
								tabIndex={0}
								data-testid="keybinding-reset-all"
								disabled={Object.keys(overrides).length === 0}
								onClick={() => setConfirmingReset(true)}
							>
								{t("settings.keyboard.editor.resetAll")}
							</Button>
						</>
					) : null
				}
			/>
			{importing ? (
				<ImportSummary importing={importing} list={list} onClose={() => setImporting(null)} />
			) : null}
			<ConfirmDialog
				open={confirmingReset}
				onOpenChange={setConfirmingReset}
				title={t("settings.keyboard.editor.resetAllTitle")}
				description={t("settings.keyboard.editor.resetAllDescription")}
				confirmLabel={t("settings.keyboard.editor.resetAllConfirm")}
				destructive
				confirmTestId="keybinding-reset-all-confirm"
				onConfirm={() => saveKeybindings({}, failure)}
			/>
		</div>
	);
}
