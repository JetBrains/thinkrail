import { useT } from "@thinkrail/locales/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { KeyHint } from "../components/KeyHint";
import type { PaletteItem } from "./model";
import { Row } from "./Row";
import { plainRow } from "./rank";

export const RECENT_SWITCHER_TEST_ID = "recent-switcher";

export interface RecentSwitcherProps {
	readonly rows: readonly PaletteItem[];
	readonly selectedIndex: number;
	readonly currentId: string | null;
	readonly nextKeys: readonly string[];
	readonly onHover: (index: number) => void;
	readonly onActivate: (index: number) => void;
}

export function RecentSwitcher({
	rows,
	selectedIndex,
	currentId,
	nextKeys,
	onHover,
	onActivate,
}: RecentSwitcherProps) {
	const t = useT();
	const listRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		listRef.current
			?.querySelector(`[data-index="${selectedIndex}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);
	return createPortal(
		<div
			data-testid={RECENT_SWITCHER_TEST_ID}
			className="-translate-x-1/2 fixed top-[15vh] left-1/2 z-50 flex max-h-[70vh] w-[min(28rem,calc(100vw-32px))] flex-col rounded-lg border border-border-default bg-container-elevated-bg text-text-default shadow-[var(--shadow-lg)]"
		>
			<p className="shrink-0 px-16 pt-8 pb-4 tr-text-metadata text-text-subtle">
				{t("search.switcher.title")}
			</p>
			<div
				ref={listRef}
				role="listbox"
				aria-label={t("search.switcher.title")}
				className="min-h-0 flex-1 overflow-y-auto px-8 pb-8"
			>
				{rows.map((item, index) => (
					<Row
						key={item.id}
						id={`recent-switcher-${index}`}
						row={plainRow(item)}
						index={index}
						selected={index === selectedIndex}
						onHover={() => onHover(index)}
						onActivate={() => onActivate(index)}
						{...(item.id === currentId ? { note: t("search.switcher.current") } : {})}
					/>
				))}
			</div>
			<footer className="@container flex h-32 shrink-0 items-center gap-x-12 overflow-hidden border-border-muted border-t px-12 tr-text-metadata text-text-subtle">
				<KeyHint keys={nextKeys} label={t("search.switcher.next")} />
				<span className="shrink-0">{t("search.switcher.release")}</span>
				<KeyHint keys={["esc"]} label={t("search.hint.close")} />
			</footer>
		</div>,
		document.body,
	);
}
