import { isImeComposing, twinArrow } from "@thinkrail/ui/keyboard";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import { cn } from "@thinkrail/ui/utils";
import type { KeyboardEvent, ReactNode } from "react";
import { LOCAL_KEY_DEFAULTS } from "../keybindings";

const RANGE_INPUT =
	"absolute inset-0 h-24 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none disabled:cursor-default [&::-moz-range-thumb]:size-16 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-border-default [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-16 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-border-default [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm focus-visible:[&::-moz-range-thumb]:focus-ring focus-visible:[&::-webkit-slider-thumb]:focus-ring";

const SLIDER_STEPS: Readonly<Record<string, 1 | -1>> = { ArrowLeft: -1, ArrowRight: 1 };

export function SettingsRangeTrack({
	steps,
	filled,
	marker,
	children,
}: {
	steps: readonly number[];
	filled: (start: number) => boolean;
	marker?: number | undefined;
	children: ReactNode;
}) {
	return (
		<div className="relative h-24 rounded-sm has-[:focus-visible]:focus-ring-editing">
			<div className="absolute inset-x-0 top-1/2 flex h-4 -translate-y-1/2 overflow-hidden rounded-full bg-control-bg">
				{steps.map((start) => (
					<span
						key={start}
						className={cn(
							"h-full flex-1",
							filled(start) ? "bg-primary" : "bg-control-bg",
							start === marker && "border-border-default border-l-2",
						)}
					/>
				))}
			</div>
			{children}
		</div>
	);
}

export function sliderStep(value: number, min: number, max: number, step: number, delta: 1 | -1) {
	const next = Math.min(max, Math.max(min, value + delta * step));
	return next === value ? null : next;
}

export interface SettingsSliderProps {
	label: string;
	valueText?: string | undefined;
	value: number;
	min: number;
	max: number;
	step?: number;
	marker?: number | undefined;
	disabled?: boolean;
	testId?: string;
	onChange: (value: number) => void;
	onCommit: () => void;
}

export function SettingsSlider({
	label,
	valueText,
	value,
	min,
	max,
	step = 1,
	marker,
	disabled = false,
	testId,
	onChange,
	onCommit,
}: SettingsSliderProps) {
	const keys = useLocalKeys("settings", LOCAL_KEY_DEFAULTS.settings);
	const steps = Array.from({ length: Math.round((max - min) / step) }, (_, i) => min + i * step);
	const low = Math.min(value, marker ?? min);
	const high = Math.max(value, marker ?? min);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.defaultPrevented || isImeComposing(event.nativeEvent)) return;
		const twin = twinArrow(keys.match(event.nativeEvent));
		const plain = !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
		const key = twin ?? (plain ? event.key : null);
		const delta = key === null ? undefined : SLIDER_STEPS[key];
		if (delta === undefined) return;
		const next = sliderStep(value, min, max, step, delta);
		if (next === null) return;
		event.preventDefault();
		onChange(next);
	};

	return (
		<SettingsRangeTrack
			steps={steps}
			filled={(start) => start >= low && start < high}
			marker={marker}
		>
			<input
				type="range"
				tabIndex={0}
				min={min}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				aria-label={label}
				aria-valuetext={valueText}
				data-testid={testId}
				className={RANGE_INPUT}
				onChange={(event) => onChange(Number(event.currentTarget.value))}
				onKeyDown={onKeyDown}
				onKeyUp={onCommit}
				onPointerUp={onCommit}
				onBlur={onCommit}
			/>
		</SettingsRangeTrack>
	);
}
