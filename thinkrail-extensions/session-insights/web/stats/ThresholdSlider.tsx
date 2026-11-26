import { localeOf, useT } from "@thinkrail/locales/react";
import { formatCount } from "../format";

/** The matrix's frequency threshold: a range over the server's steps, greying cells below it. */
export function ThresholdSlider({
	thresholds,
	step,
	onStep,
}: {
	thresholds: readonly number[];
	step: number;
	onStep: (step: number) => void;
}) {
	const t = useT();
	const locale = localeOf(t);
	const value = t("sessionInsights.sequences.thresholdValue", {
		value: formatCount(locale, thresholds[step] ?? 1),
	});
	return (
		<label className="flex items-center gap-8">
			<span>{t("sessionInsights.sequences.threshold")}</span>
			<input
				type="range"
				data-testid="sequence-threshold"
				min={0}
				max={thresholds.length - 1}
				step={1}
				value={step}
				aria-valuetext={value}
				onChange={(event) => onStep(Number(event.currentTarget.value))}
				className="w-96 accent-primary"
			/>
			<span className="w-48 tr-code-text-small text-text-default">{value}</span>
		</label>
	);
}
