import { RiKeyboardLine, RiSearchLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { Keycaps } from "@thinkrail/ui/keycaps";
import { cn } from "@thinkrail/ui/utils";
import { useId, useRef, useState } from "react";
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

function readRows(): ShortcutRow[] {
	return shortcutRows({ desktop: hasNativeShortcuts() });
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
}: {
	surface: ShortcutSurface;
	rows: readonly ShortcutRow[];
}) {
	const t = useT();
	const headingId = useId();
	return (
		<section
			aria-labelledby={headingId}
			data-testid="shortcuts-section"
			data-surface={surface}
			className="flex flex-col gap-4"
		>
			<h3 id={headingId} className="tr-text-eyebrow text-text-muted">
				{t(SHORTCUT_SURFACE_TITLES[surface])}
			</h3>
			<ul className="flex flex-col">
				{rows.map((row) => (
					<li
						key={row.id}
						data-testid="shortcuts-row"
						data-shortcut={row.id}
						className="flex min-h-panel-row items-center justify-between gap-12 py-2"
					>
						<span className="min-w-0 tr-text-ui text-text-default">{t(row.title)}</span>
						<span className="flex shrink-0 flex-wrap items-center justify-end gap-8">
							{row.chords.map((chord) => (
								<Keycaps key={chord.label} keys={chord.keys} />
							))}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

export function ShortcutsReference({
	first = null,
	className,
}: {
	first?: ShortcutSurface | null;
	className?: string;
}) {
	const t = useT();
	const [rows] = useState(readRows);
	const [query, setQuery] = useState("");
	const list = useRef<HTMLDivElement>(null);
	const needle = query.trim().toLocaleLowerCase();
	const shown =
		needle === ""
			? rows
			: rows.filter(
					(row) =>
						t(row.title).toLocaleLowerCase().includes(needle) ||
						row.chords.some((chord) => chord.label.toLocaleLowerCase().includes(needle)),
				);
	const order =
		first === null ? SHORTCUT_SURFACES : [first, ...SHORTCUT_SURFACES.filter((s) => s !== first)];
	const sections = order.flatMap((surface) => {
		const surfaceRows = shown.filter((row) => row.surface === surface);
		return surfaceRows.length === 0 ? [] : [{ surface, rows: surfaceRows }];
	});
	return (
		<div className={cn("flex min-h-0 flex-col gap-12", className)}>
			<div className="relative shrink-0">
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
			<div
				ref={list}
				data-testid="shortcuts-list"
				className="flex min-h-0 flex-col gap-16 overflow-y-auto"
			>
				{sections.length === 0 ? (
					<p className="tr-text-metadata text-text-muted">{t("shortcuts.noMatch")}</p>
				) : (
					sections.map((section) => (
						<ShortcutSection key={section.surface} surface={section.surface} rows={section.rows} />
					))
				)}
			</div>
		</div>
	);
}

function ShortcutsDialog() {
	const t = useT();
	const [first, setFirst] = useState<ShortcutSurface | null>(null);
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
				className="h-[min(80vh,720px)] max-w-[40rem] overflow-hidden"
				onOpenAutoFocus={() => {
					const previous = document.activeElement;
					returnFocus.current = previous instanceof HTMLElement ? previous : null;
					setFirst(shortcutSurfaceOf(previous));
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
				<ShortcutsReference first={first} className="flex-1" />
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
