import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useRef, useState } from "react";
import {
	applyFontScale,
	clampFontScale,
	FONT_SCALE_MAX,
	FONT_SCALE_MIN,
	FONT_SCALE_STEP,
	fontScalePercent,
	fontScalePosition,
	readFontScale,
	writeFontScale,
} from "../styles/fontScale";
import { MOVEMENT_THUMB } from "./ChatSettings";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";

/**
 * Text above the slider grows with the scale and would push the slider out of the settings pane
 * mid-drag. Scroll the pane by however far the slider moved, so it stays under the pointer.
 */
function applyAnchored(scale: number, slider: HTMLElement | null): void {
	const pane = slider ? scrollParent(slider) : null;
	const before = slider?.getBoundingClientRect().top;
	applyFontScale(scale);
	if (!slider || !pane || before === undefined) return;
	const moved = slider.getBoundingClientRect().top - before;
	if (moved !== 0) pane.scrollTop += moved;
}

function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight)
			return node;
	}
	return null;
}

/**
 * Scales the typography custom properties on `documentElement`, so the whole interface grows or
 * shrinks without a rebuild. The value lives in the reader's own preference storage rather than in
 * server settings: it is a display preference, not workspace configuration.
 */
export function FontScaleControl() {
	const t = useT();
	const [scale, setScale] = useState(() => clampFontScale(readFontScale()));
	const sliderRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		applyFontScale(scale);
	}, [scale]);

	const percent = fontScalePercent(scale);
	const position = fontScalePosition(scale);

	return (
		<div
			data-testid="font-scale-control"
			className={cn(SETTINGS_ROWS_CONTAINER, "border-border-muted border-b")}
		>
			<SettingsRow
				label={t("settings.appearance.fontScale.label")}
				description={t("settings.appearance.fontScale.description")}
				control={
					<div className="flex items-center gap-12">
						<span
							data-testid="font-scale-value"
							className="min-w-48 text-right tr-text-ui text-text-default tabular-nums"
						>
							{percent}%
						</span>
						<div ref={sliderRef} className="relative h-24 w-160">
							<div
								aria-hidden="true"
								className="absolute inset-x-0 top-1/2 flex h-4 -translate-y-1/2 overflow-hidden rounded-full bg-control-bg"
							>
								<span className="h-full bg-primary" style={{ width: `${position}%` }} />
							</div>
							<input
								type="range"
								className={MOVEMENT_THUMB}
								min={FONT_SCALE_MIN}
								max={FONT_SCALE_MAX}
								step={FONT_SCALE_STEP}
								value={scale}
								aria-label={t("settings.appearance.fontScale.label")}
								aria-valuetext={t("settings.appearance.fontScale.value", { percent })}
								data-testid="font-scale-input"
								onChange={(event) => {
									const next = clampFontScale(Number(event.target.value));
									// Before the write notifies: renderers that read the custom properties
									// during that render must already see the new sizes.
									applyAnchored(next, sliderRef.current);
									setScale(next);
									writeFontScale(next);
								}}
							/>
						</div>
					</div>
				}
			/>
		</div>
	);
}
