import { RiKeyboardLine, RiSearchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { cn } from "@thinkrail/ui/utils";
import { type Ref, useEffect, useId, useRef, useState } from "react";
import { enabledWebExtensions } from "../extensions";
import {
	keybindingKeys,
	matchKeybinding,
	SHORTCUT_SURFACE_TITLES,
	SHORTCUT_SURFACES,
	type ShortcutRow,
	type ShortcutSurface,
	shortcutRows,
} from "../keybindings";
import { useAppStore } from "../store";
import { AuxiliaryRailActionButton, type AuxiliaryRailControlProps } from "./layout";
import { shortcutSurfaceOf } from "./shortcutSurface";
import { hasNativeShortcuts } from "./useAppShortcuts";

function useShortcutRows(): ShortcutRow[] {
	const [desktop] = useState(hasNativeShortcuts);
	const disabled = useAppStore((state) => state.disabledExtensions);
	const extra = enabledWebExtensions(disabled).flatMap(({ shortcuts = [] }) =>
		shortcuts.map((shortcut) => ({ ...shortcut, surface: "general" as const })),
	);
	return shortcutRows({ desktop, extra });
}

const SCROLL_PAGES: ReadonlyMap<string, number> = new Map([
	["ArrowDown", 0.25],
	["ArrowUp", -0.25],
	["PageDown", 1],
	["PageUp", -1],
]);

function ShortcutSection({
	surface,
	rows,
	current,
	ref,
}: {
	surface: ShortcutSurface;
	rows: readonly ShortcutRow[];
	current: boolean;
	ref?: Ref<HTMLElement>;
}) {
	const t = useT();
	const headingId = useId();
	return (
		<section
			ref={ref}
			aria-labelledby={headingId}
			data-testid="shortcuts-section"
			data-surface={surface}
			data-current={current ? "true" : undefined}
			className="flex break-inside-avoid flex-col gap-4 pb-16 last:pb-0"
		>
			<h3
				id={headingId}
				className={cn("tr-text-eyebrow", current ? "text-text-default" : "text-text-muted")}
			>
				{t(SHORTCUT_SURFACE_TITLES[surface])}
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
						</span>
						<span className="flex min-w-0 flex-wrap items-center justify-end gap-x-8 gap-y-4">
							{row.chords.map((chord) => (
								<Keycaps key={chord.label} keys={chord.keys} className="whitespace-nowrap" />
							))}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

export function ShortcutsReference({
	current = null,
	columns = false,
	className,
}: {
	current?: ShortcutSurface | null;
	columns?: boolean;
	className?: string;
}) {
	const t = useT();
	const rows = useShortcutRows();
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
	const sections = SHORTCUT_SURFACES.flatMap((surface) => {
		const surfaceRows = shown.filter((row) => row.surface === surface);
		return surfaceRows.length === 0 ? [] : [{ surface, rows: surfaceRows }];
	});
	useEffect(() => {
		if (current === null) return;
		currentSection.current?.scrollIntoView({ block: "nearest" });
	}, [current]);
	return (
		<div className={cn("flex min-h-0 flex-col gap-12", className)}>
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
					<div className={columns ? "columns-2xs gap-x-24" : undefined}>
						{sections.map((section) => (
							<ShortcutSection
								key={section.surface}
								ref={section.surface === current ? currentSection : null}
								surface={section.surface}
								rows={section.rows}
								current={section.surface === current}
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
					if (matchKeybinding(event.nativeEvent) !== "shortcuts.open") return;
					event.preventDefault();
					close();
				}}
			>
				<DialogTitle>{t("shortcuts.title")}</DialogTitle>
				<ShortcutsReference current={current} columns className="flex-1" />
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
	const [shortcut] = useState(() => keybindingKeys("shortcuts.open"));
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
