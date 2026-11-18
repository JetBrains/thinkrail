import {
	RiAlertLine,
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiCornerDownRightLine,
	RiLockLine,
	RiPencilLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { cn } from "@thinkrail/ui/utils";
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { KeybindingEntry } from "../keybindings";
import { useTreeItem } from "../panels/treeNavigation";
import { SETTINGS_TAG } from "../settingsKit";
import { chordName, type KeybindingArea, shortcutSettingId } from "./keybindingAreas";
import { entryTitle, scopeText } from "./keybindingState";

const RESET_SLOT = "flex min-w-64 shrink-0 justify-end";

const TREE_ROW =
	"flex w-full rounded-sm px-8 py-4 text-left transition-colors focus-visible:focus-ring-inset";

function fromControl(event: MouseEvent<HTMLElement>): boolean {
	return event.target instanceof Element && event.target.closest("button, [role='alert']") !== null;
}

const plainKey = (event: KeyboardEvent<HTMLElement>) =>
	!(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);

export function KeybindingScopeCaption({ scope }: { scope: string }) {
	const t = useT();
	return (
		<span
			data-testid="keybinding-scope"
			data-scope={scope}
			className="flex min-w-0 items-center gap-8 tr-text-metadata text-text-muted"
		>
			<span className={cn(SETTINGS_TAG, "text-text-muted")}>
				{t("settings.keyboard.editor.local")}
			</span>
			<span className="min-w-0 break-words">{scopeText(t, scope, "where")}</span>
		</span>
	);
}

export function KeybindingAreaRow({
	area,
	title,
	count,
	expanded,
	enabled,
	resettable,
	onToggle,
	onReset,
}: {
	area: KeybindingArea;
	title: string;
	count: string;
	expanded: boolean;
	enabled: boolean;
	resettable: boolean;
	onToggle: () => void;
	onReset: () => void;
}) {
	const t = useT();
	const treeItem = useTreeItem(`area:${area.id}`, {
		level: 1,
		label: title,
		expanded,
		toggles: true,
	});
	const Chevron = expanded ? RiArrowDownSLine : RiArrowRightSLine;
	return (
		<div
			{...treeItem}
			role="treeitem"
			tabIndex={treeItem.tabIndex ?? -1}
			data-testid="keybinding-group"
			data-area={area.id}
			className={cn(TREE_ROW, "min-h-40 items-center gap-8 hover:bg-control-bg-hovered")}
			onClick={(event) => {
				if (!fromControl(event)) onToggle();
			}}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget || isImeComposing(event.nativeEvent)) return;
				if ((event.key !== "Enter" && event.key !== " ") || !plainKey(event)) return;
				event.preventDefault();
				onToggle();
			}}
		>
			<Chevron aria-hidden className="size-16 shrink-0 text-text-muted" />
			<span className="flex min-w-0 flex-1 flex-wrap items-center gap-8">
				<span className="tr-text-ui text-text-default">{title}</span>
				{area.surface === null ? (
					<span className={cn(SETTINGS_TAG, "text-text-muted")}>
						{t("settings.keyboard.editor.extension")}
					</span>
				) : null}
				{enabled ? null : (
					<span className={cn(SETTINGS_TAG, "text-text-muted")}>{t("common.off")}</span>
				)}
				{area.scope === null ? null : <KeybindingScopeCaption scope={area.scope} />}
			</span>
			{area.changed > 0 ? (
				<span
					data-testid="keybinding-group-changed"
					className="flex shrink-0 items-center gap-4 tr-text-metadata text-primary"
				>
					<span aria-hidden className="size-8 rounded-full bg-primary" />
					{t("settings.keyboard.editor.changedCount", { count: area.changed })}
				</span>
			) : null}
			<span
				data-testid="keybinding-group-count"
				className="shrink-0 tr-text-metadata text-text-muted"
			>
				{count}
			</span>
			{resettable ? (
				<span className={RESET_SLOT}>
					{area.changed > 0 ? (
						<Button
							variant="ghost"
							size="s"
							tabIndex={treeItem.tabIndex ?? -1}
							data-setting-side=""
							data-setting-reset=""
							data-testid="keybinding-group-reset"
							aria-label={t("settings.keyboard.editor.resetArea", {
								count: area.changed,
								area: title,
							})}
							onClick={(event) => {
								event.currentTarget.closest<HTMLElement>("[role='treeitem']")?.focus();
								onReset();
							}}
						>
							{t("settings.keyboard.editor.reset")}
						</Button>
					) : null}
				</span>
			) : null}
		</div>
	);
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

export function KeybindingShortcutRow({
	entry,
	platform,
	winner,
	changeable,
	recording,
	dimmed,
	message,
	onRecord,
	onReset,
	onKeyDown,
	onBlur,
}: {
	entry: KeybindingEntry;
	platform: string;
	winner: (command: string) => string;
	changeable: boolean;
	recording: boolean;
	dimmed: boolean;
	message: ReactNode;
	onRecord: () => void;
	onReset: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	onBlur: (event: FocusEvent<HTMLDivElement>) => void;
}) {
	const t = useT();
	const title = entryTitle(t, entry);
	const treeItem = useTreeItem(entry.id, { level: 2, label: title });
	const sideTab = treeItem.tabIndex ?? -1;
	const lost = entry.chords.filter((chord) => chord.lostTo !== null);
	const defaults = entry.defaults.map((chord) => chordName(chord, platform));
	return (
		<li role="none" data-focus-row={entry.id}>
			<div
				{...treeItem}
				role="treeitem"
				tabIndex={sideTab}
				data-testid="keybinding-row"
				data-command={entry.id}
				data-alias={entry.id === entry.command ? undefined : entry.command}
				data-scope={entry.scope ?? undefined}
				data-custom={entry.custom ? "true" : undefined}
				data-locked={entry.locked ? "true" : undefined}
				data-recording={recording ? "true" : undefined}
				data-setting-id={shortcutSettingId(entry.id)}
				data-focus-row-primary=""
				aria-disabled={changeable ? undefined : true}
				className={cn(
					TREE_ROW,
					"flex-col gap-4",
					changeable && "cursor-pointer hover:bg-control-bg-hovered",
					recording && "bg-primary-subtle",
				)}
				onClick={(event) => {
					if (changeable && !recording && !fromControl(event)) onRecord();
				}}
				onKeyDown={onKeyDown}
				onBlur={onBlur}
			>
				<div className="flex flex-wrap items-center gap-x-12 gap-y-4">
					<div className="flex min-w-160 flex-1 flex-col items-start gap-2">
						<span className="flex flex-wrap items-center gap-8">
							<span className={cn("tr-text-ui", dimmed ? "text-text-muted" : "text-text-default")}>
								{title}
							</span>
							{entry.custom ? (
								<span data-testid="keybinding-custom" className={cn(SETTINGS_TAG, "text-primary")}>
									{t("settings.kit.changed")}
								</span>
							) : null}
						</span>
						{entry.custom ? (
							<span data-testid="keybinding-default" className="tr-text-metadata text-text-muted">
								{t("settings.keyboard.editor.default", {
									chords:
										defaults.length === 0
											? t("settings.keyboard.editor.unbound")
											: defaults.join(", "),
								})}
							</span>
						) : null}
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
					</div>
					<FixedChords entry={entry} />
					<span
						data-testid="keybinding-chord"
						className="flex min-h-24 shrink-0 flex-wrap items-center justify-end gap-x-8 gap-y-4"
					>
						<EntryChords entry={entry} recording={recording} />
					</span>
					{changeable ? (
						<span className="flex shrink-0 flex-wrap items-center justify-end gap-4">
							<Button
								variant="outline"
								size="s"
								tabIndex={sideTab}
								data-setting-side=""
								data-testid="keybinding-change"
								aria-label={t("settings.keyboard.editor.changeNamed", { command: title })}
								onClick={onRecord}
							>
								{t("settings.keyboard.editor.change")}
							</Button>
							{lost.length > 0 ? (
								<Button
									variant="outline"
									size="s"
									tabIndex={sideTab}
									data-setting-side=""
									data-testid="keybinding-assign-another"
									onClick={onRecord}
								>
									{t("settings.keyboard.editor.assignAnother")}
								</Button>
							) : null}
							<span className={RESET_SLOT}>
								{entry.custom ? (
									<Button
										variant="ghost"
										size="s"
										tabIndex={sideTab}
										data-setting-side=""
										data-setting-reset=""
										data-testid="keybinding-reset"
										aria-label={t("settings.kit.resetLabel", { label: title })}
										onClick={onReset}
									>
										{t("settings.keyboard.editor.reset")}
									</Button>
								) : null}
							</span>
						</span>
					) : null}
				</div>
				{message}
			</div>
		</li>
	);
}
