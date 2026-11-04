import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useRef, useState } from "react";
import {
	applyFontScale,
	DEFAULT_FONT_SCALE,
	FONT_SCALE_MAX,
	FONT_SCALE_MIN,
	FONT_SCALE_STEP,
	fontScalePercent,
	readFontScale,
	writeFontScale,
} from "@/fonts";
import { SETTINGS_RANGE_INPUT, SETTINGS_RANGE_STACKED, SettingsRangeTrack } from "./SettingsRange";

/** One boundary per step, so the track fills in the same steps the slider moves in. */
const TRACK_STEPS = Array.from(
	{ length: Math.round((FONT_SCALE_MAX - FONT_SCALE_MIN) / FONT_SCALE_STEP) },
	(_, index) => FONT_SCALE_MIN + index * FONT_SCALE_STEP,
);

/**
 * The pane the slider scrolls in. Growing the text above the thumb pushes the thumb down the page,
 * and past a point it leaves the window while the pointer keeps dragging: anchoring the pane to the
 * thumb's own movement keeps it under the pointer.
 */
function scrollParent(node: HTMLElement | null): HTMLElement | null {
	for (let element = node?.parentElement ?? null; element; element = element.parentElement) {
		const style = getComputedStyle(element);
		if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) {
			return element;
		}
	}
	return null;
}

export function FontScaleControl() {
	const t = useT();
	const [scale, setScale] = useState(() => readFontScale());
	const inputRef = useRef<HTMLInputElement | null>(null);
	const percent = fontScalePercent(scale);

	const applyAnchored = (next: number) => {
		const anchor = inputRef.current;
		const pane = scrollParent(anchor);
		const before = anchor?.getBoundingClientRect().top ?? 0;
		applyFontScale(next);
		setScale(next);
		if (!pane || !anchor) return;
		const moved = anchor.getBoundingClientRect().top - before;
		if (Math.abs(moved) > 1) pane.scrollTop += moved;
	};

	return (
		<div className="flex flex-col gap-8" data-testid="font-scale-control">
			<div className="flex items-baseline justify-between gap-12">
				<div className="flex flex-col gap-2">
					<span className="text-text-default tr-text-ui">
						{t("settings.appearance.fontScale.label")}
					</span>
					<span className="text-text-muted tr-text-metadata">
						{t("settings.appearance.fontScale.description")}
					</span>
				</div>
				<span data-testid="font-scale-value" className="text-text-default tr-text-ui">
					{t("settings.appearance.fontScale.value", { value: percent })}
				</span>
			</div>
			<SettingsRangeTrack
				steps={TRACK_STEPS}
				filled={(start) => start < scale - FONT_SCALE_STEP / 2}
				marker={DEFAULT_FONT_SCALE}
			>
				<input
					ref={inputRef}
					type="range"
					data-testid="font-scale-input"
					aria-label={t("settings.appearance.fontScale.label")}
					aria-valuetext={t("settings.appearance.fontScale.value", { value: percent })}
					min={FONT_SCALE_MIN}
					max={FONT_SCALE_MAX}
					step={FONT_SCALE_STEP}
					value={scale}
					onChange={(event) => applyAnchored(Number(event.currentTarget.value))}
					onPointerUp={() => writeFontScale(scale)}
					onKeyUp={() => writeFontScale(scale)}
					onBlur={() => writeFontScale(scale)}
					className={cn(SETTINGS_RANGE_INPUT, SETTINGS_RANGE_STACKED, "cursor-pointer")}
				/>
			</SettingsRangeTrack>
			<div className="flex items-center justify-between text-text-muted tr-text-metadata">
				<span>{fontScalePercent(FONT_SCALE_MIN)}%</span>
				<span>{fontScalePercent(FONT_SCALE_MAX)}%</span>
			</div>
		</div>
	);
}
