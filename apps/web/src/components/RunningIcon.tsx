import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { BRAND_MARK_SEGMENTS } from "../constants/branding";

const FRAME_A = "M20 195 V110 A90 90 0 0 1 110 20 H650 A90 90 0 0 1 740 110 V552";
const FRAME_B = "M20 225 V650 A90 90 0 0 0 110 740 H650 A90 90 0 0 0 740 650 V548";

/** Stroke centre-lines for the animation, each clipped to a region from `BRAND_MARK_SEGMENTS`. */
const STROKES: ReadonlyArray<{
	d: string;
	join: "miter" | "round";
	width: number;
	clip: keyof typeof BRAND_MARK_SEGMENTS;
	className: string;
}> = [
	{
		d: "M0 20 H312",
		join: "miter",
		width: 40,
		clip: "tHorizontal",
		className: "motion-safe:animate-loader-s1",
	},
	{
		d: "M0 90 H130 V449.5",
		join: "miter",
		width: 40,
		clip: "tVertical",
		className: "motion-safe:animate-loader-s2",
	},
	{
		d: "M340 20 H401 C444.6 20 481 55.5 481 98.5 V190 C481 235 462 272 432 290 L540 466",
		join: "round",
		width: 46,
		clip: "rUpperTail",
		className: "motion-safe:animate-loader-a1",
	},
	{
		d: "M200 449.5 V321 C200 270 245 228 304 228 H374 C394 228 410 213 410 194 V120 C410 102 398 90 380 90 H180",
		join: "miter",
		width: 44,
		clip: "rBowl",
		className: "motion-safe:animate-loader-c3",
	},
	{
		d: "M200 335 V140",
		join: "miter",
		width: 40,
		clip: "rBowl",
		className: "motion-safe:animate-loader-c2",
	},
	{
		d: "M269 449.5 V332 C269 312 285 300 305 300 H350 L457 466",
		join: "miter",
		width: 46,
		clip: "rLowerLeg",
		className: "motion-safe:animate-loader-b1",
	},
];

export function RunningIcon({ className }: { className?: string | undefined }) {
	const id = useId();
	const clipId = (name: string) => `${id}-${name}`;

	return (
		<span
			data-testid="running-icon"
			data-running="true"
			role="img"
			aria-label="Agent working"
			className={cn("inline-flex shrink-0 items-center justify-center", className)}
		>
			<svg aria-hidden="true" viewBox="0 0 760 760" className="size-full">
				<defs>
					{Object.entries(BRAND_MARK_SEGMENTS).map(([name, d]) => (
						<clipPath key={name} id={clipId(name)}>
							<path d={d} />
						</clipPath>
					))}
				</defs>
				{/* Frame: two halves running from the gap and meeting on the right */}
				<path
					d={FRAME_A}
					fill="none"
					stroke="currentColor"
					strokeWidth="40"
					strokeLinejoin="round"
					strokeDasharray="1000 1000"
					pathLength="1000"
					className="motion-safe:animate-loader-fa"
				/>
				<path
					d={FRAME_B}
					fill="none"
					stroke="currentColor"
					strokeWidth="40"
					strokeLinejoin="round"
					strokeDasharray="1000 1000"
					pathLength="1000"
					className="motion-safe:animate-loader-fb"
				/>
				{/* Logo centered; each line clipped to its part of the original contour */}
				<g transform="translate(101.5 155)">
					{STROKES.map((stroke) => (
						<path
							key={stroke.d}
							d={stroke.d}
							fill="none"
							stroke="currentColor"
							strokeWidth={stroke.width}
							strokeLinejoin={stroke.join}
							strokeDasharray="1000 1000"
							pathLength="1000"
							clipPath={`url(#${clipId(stroke.clip)})`}
							className={stroke.className}
						/>
					))}
				</g>
			</svg>
		</span>
	);
}
