import { RiAlertLine, RiKeyboardLine, RiSearchLine } from "@remixicon/react";
import type { WebExtension } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { cn } from "@thinkrail/ui/utils";
import { type Ref, useEffect, useId, useRef, useState } from "react";
import { enabledWebExtensions } from "../extensions";
import {
	matchKeybinding,
	SHORTCUT_SURFACE_TITLES,
	SHORTCUT_SURFACES,
	type ShortcutRow,
	type ShortcutSurface,
	shortcutRows,
} from "../keybindings";
import { useAppStore } from "../store";
import {
	commandTitle,
	useKeybindingKeys,
	useKeybindingList,
	useResolvedKeybindings,
} from "./keybindingState";
import { AuxiliaryRailActionButton, type AuxiliaryRailControlProps } from "./layout";
import { shortcutSurfaceOf } from "./shortcutSurface";
import { hasNativeShortcuts } from "./useAppShortcuts";

interface ShortcutSectionRows {
	readonly key: string;
	readonly surface: ShortcutSurface | null;
	readonly extension: string | null;
	readonly title: string;
	readonly rows: readonly ShortcutRow[];
}

function useShortcutRows(desktop: boolean): {
	rows: ShortcutRow[];
	extensions: readonly WebExtension[];
} {
	const keybindings = useResolvedKeybindings();
	const disabled = useAppStore((state) => state.disabledExtensions);
	const extensions = enabledWebExtensions(disabled);
	const extra = extensions.flatMap(({ name, shortcuts = [] }) =>
		shortcuts.map((shortcut) => ({ ...shortcut, surface: "general" as const, extension: name })),
	);
	return { rows: shortcutRows({ desktop, keybindings, extra }), extensions };
}

/** The catalog's surfaces in order, then one section per enabled extension, titled like its Keyboard area. */
export function shortcutSections(
	t: Translator,
	rows: readonly ShortcutRow[],
	extensions: readonly WebExtension[],
): ShortcutSectionRows[] {
	return [
		...SHORTCUT_SURFACES.map((surface) => ({
			key: surface,
			surface,
			extension: null,
			title: t(SHORTCUT_SURFACE_TITLES[surface]),
			rows: rows.filter((row) => row.extension === undefined && row.surface === surface),
		})),
		...extensions.map(({ name, title }) => ({
			key: `extension:${name}`,
			surface: null,
			extension: name,
			title: title ? t(title) : name,
			rows: rows.filter((row) => row.extension === name),
		})),
	].filter((section) => section.rows.length > 0);
}

const SCROLL_PAGES: ReadonlyMap<string, number> = new Map([
	["ArrowDown", 0.25],
	["ArrowUp", -0.25],
	["PageDown", 1],
	["PageUp", -1],
]);

function ShortcutSection({
	section,
	current,
	winner,
	ref,
}: {
	section: ShortcutSectionRows;
	current: boolean;
	winner: (command: string) => string;
	ref?: Ref<HTMLElement>;
}) {
	const t = useT();
	const headingId = useId();
	const { rows } = section;
	return (
		<section
			ref={ref}
			aria-labelledby={headingId}
			data-testid="shortcuts-section"
			data-surface={section.surface ?? "extension"}
			data-extension={section.extension ?? undefined}
			data-current={current ? "true" : undefined}
			className="flex break-inside-avoid flex-col gap-4 pb-16 last:pb-0"
		>
			<h3
				id={headingId}
				className={cn("tr-text-eyebrow", current ? "text-text-default" : "text-text-muted")}
			>
				{section.title}
				{current ? (
					<span className="ml-8 tr-text-metadata text-text-muted">
						{t("shortcuts.currentSurface")}
					</span>
				) : null}
			</h3>
			<ul className="flex flex-col">
				{rows.map((row) => (
					<li
						key={row.id}
						data-testid="shortcuts-row"
						data-shortcut={row.id}
						className="flex min-h-panel-row items-center gap-12 py-2"
					>
						<span className="min-w-0 shrink-0 grow basis-1/2 tr-text-ui text-text-default">
							{t(row.title)}
							{row.conflicts.map((conflict) => (
								<span
									key={conflict.label}
									data-testid="shortcuts-conflict"
									className="flex items-center gap-4 tr-text-metadata text-feedback-warning"
								>
									<RiAlertLine aria-hidden className="size-12 shrink-0" />
									{t("shortcuts.inactive", { winner: winner(conflict.winner) })}
								</span>
							))}
						</span>
						<span className="flex min-w-0 flex-wrap items-center justify-end gap-x-8 gap-y-4">
							{row.chords.map((chord) => (
								<Keycaps key={chord.label} keys={chord.keys} className="whitespace-nowrap" />
							))}
							{row.conflicts.map((conflict) => (
								<Keycaps
									key={`lost:${conflict.label}`}
									keys={conflict.keys}
									className="whitespace-nowrap [&_kbd]:text-text-subtle [&_kbd]:line-through"
								/>
							))}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function ShortcutsReference({ current }: { current: ShortcutSurface | null }) {
	const t = useT();
	const [desktop] = useState(hasNativeShortcuts);
	const { rows, extensions } = useShortcutRows(desktop);
	const keybindingList = useKeybindingList(desktop);
	const [query, setQuery] = useState("");
	const list = useRef<HTMLDivElement>(null);
	const currentSection = useRef<HTMLElement>(null);
	const needle = query.trim().toLocaleLowerCase();
	const shown =
		needle === ""
			? rows
			: rows.filter(
					(row) =>
						t(row.title).toLocaleLowerCase().includes(needle) ||
						row.chords.some((chord) => chord.label.toLocaleLowerCase().includes(needle)),
				);
	const sections = shortcutSections(t, shown, extensions);
	useEffect(() => {
		if (current === null) return;
		currentSection.current?.scrollIntoView({ block: "nearest" });
	}, [current]);
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-12">
			<div className="flex shrink-0 items-center gap-12">
				<div className="relative min-w-0 flex-1">
					<RiSearchLine
						aria-hidden
						className="pointer-events-none absolute top-1/2 left-8 size-14 -translate-y-1/2 text-text-muted"
					/>
					<input
						type="text"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("shortcuts.filterPlaceholder")}
						aria-label={t("shortcuts.filter")}
						data-testid="shortcuts-filter"
						aria-keyshortcuts="ArrowUp ArrowDown PageUp PageDown"
						onKeyDown={(event) => {
							const pages = SCROLL_PAGES.get(event.key);
							if (pages === undefined || isImeComposing(event.nativeEvent)) return;
							if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
							event.preventDefault();
							list.current?.scrollBy({ top: pages * list.current.clientHeight });
						}}
						className="h-32 w-full rounded-sm border border-control-border-default bg-control-bg pr-8 pl-24 tr-text-ui text-text-default transition-colors placeholder:text-text-muted focus:border-control-border-active focus-visible:focus-ring"
					/>
				</div>
				<span data-testid="shortcuts-count" className="shrink-0 tr-text-metadata text-text-muted">
					{needle === ""
						? t("shortcuts.count", { count: rows.length })
						: t("shortcuts.countFiltered", { shown: shown.length, total: rows.length })}
				</span>
			</div>
			<div ref={list} data-testid="shortcuts-list" className="min-h-0 overflow-y-auto">
				{sections.length === 0 ? (
					<p className="tr-text-metadata text-text-muted">{t("shortcuts.noMatch")}</p>
				) : (
					<div className="columns-2xs gap-x-24">
						{sections.map((section) => (
							<ShortcutSection
								key={section.key}
								ref={
									section.surface !== null && section.surface === current ? currentSection : null
								}
								section={section}
								current={section.surface !== null && section.surface === current}
								winner={(command) => commandTitle(t, keybindingList, command)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function ShortcutsDialog() {
	const t = useT();
	const [current, setCurrent] = useState<ShortcutSurface | null>(null);
	const returnFocus = useRef<HTMLElement | null>(null);
	const keybindings = useResolvedKeybindings();
	const close = () => useAppStore.getState().closeShortcuts();
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent
				data-testid="shortcuts-dialog"
				aria-describedby={undefined}
				className="h-[calc(100dvh-2*var(--space-24))] w-[calc(100%-2*var(--space-24))] max-w-none overflow-hidden"
				onOpenAutoFocus={() => {
					const previous = document.activeElement;
					returnFocus.current = previous instanceof HTMLElement ? previous : null;
					setCurrent(shortcutSurfaceOf(previous));
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
				}}
				onKeyDown={(event) => {
					if (isImeComposing(event.nativeEvent)) return;
					if (matchKeybinding(keybindings, event.nativeEvent) !== "shortcuts.open") return;
					event.preventDefault();
					close();
				}}
			>
				<DialogTitle>{t("shortcuts.title")}</DialogTitle>
				<ShortcutsReference current={current} />
			</DialogContent>
		</Dialog>
	);
}

export function ShortcutsDialogHost() {
	const open = useAppStore((state) => state.shortcutsOpen);
	return open ? <ShortcutsDialog /> : null;
}

function ShortcutsRailButton({ control }: { control: AuxiliaryRailControlProps }) {
	const t = useT();
	const shortcut = useKeybindingKeys("shortcuts.open");
	return (
		<AuxiliaryRailActionButton
			region="left"
			icon={RiKeyboardLine}
			label={t("shortcuts.title")}
			shortcut={shortcut}
			testId="open-shortcuts"
			control={control}
			onClick={() => useAppStore.getState().openShortcuts()}
		/>
	);
}

export function renderShortcutsRailButton(control: AuxiliaryRailControlProps) {
	return <ShortcutsRailButton control={control} />;
}
