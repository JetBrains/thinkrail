import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";

const CLIP_PATHS = {
	clip0:
		"M460.1 294.06L458.06 290.8C465.46 284.43 471.77 277.49 477.05 270.08C492.54 248.38 499.3 222.65 499.18 195.36L499.11 179.98C499.75 173.77 500 170 500 170L499.98 98.35C499.96 44.03 455.91 1e-05 401.59 1e-05H340V31.11C340 36.02 343.98 40 348.89 40L398.91 40.78C433.09 41.17 460.72 68.76 461.13 102.95L462.2 191.14C462.63 219.89 462.04 258.15 399.31 277.63L503.44 449.2H556.36L500.38 358.64L460.1 294.06Z",
	clip1:
		"M374.14 250C405.09 250 430.16 224.89 430.12 193.95L430 111.3C430 88.49 411.51 70 388.7 70H180V101.775C180 106.318 183.682 110 188.225 110H374.87C383.226 110 390 116.774 390 125.13V189C390 198.542 382.192 206.35 372.65 206.35H311.86C254.74 206.35 230.59 222.1 223.64 227.89C222.74 228.65 221.36 228.01 221.35 226.82L220.429 146.859C220.385 143.058 217.291 140 213.491 140H180V449.2H220V321.24C220 277.27 244.37 250 299.74 250H374.14Z",
	clip2: "M140.57 70H0V110H110V449.2H150V79.43C150 74.22 145.78 70 140.57 70Z",
	clip3: "M310 31.88V0H0V40H301.88C306.37 40 310 36.36 310 31.88Z",
	clip4:
		"M351.9 280H288.66C266.79 280 249.05 297.74 249.05 319.61V449.2H289.11L289.73 340.61C289.79 329.21 299.05 320 310.45 320H333.84C337.68 320 341.26 321.95 343.34 325.18L423.06 449.2H468.4L371.84 291.19C367.59 284.24 360.04 280 351.9 280Z",
} as const;

const FRAME_A = "M20 195 V110 A90 90 0 0 1 110 20 H650 A90 90 0 0 1 740 110 V552";
const FRAME_B = "M20 225 V650 A90 90 0 0 0 110 740 H650 A90 90 0 0 0 740 650 V548";

const STROKES = [
	{
		d: "M0 20 H312",
		join: "miter",
		width: 40,
		clip: "clip3",
		className: "motion-safe:animate-loader-s1",
	},
	{
		d: "M0 90 H130 V449.5",
		join: "miter",
		width: 40,
		clip: "clip2",
		className: "motion-safe:animate-loader-s2",
	},
	{
		d: "M340 20 H401 C444.6 20 481 55.5 481 98.5 V190 C481 235 462 272 432 290 L540 466",
		join: "round",
		width: 46,
		clip: "clip0",
		className: "motion-safe:animate-loader-a1",
	},
	{
		d: "M200 449.5 V321 C200 270 245 228 304 228 H374 C394 228 410 213 410 194 V120 C410 102 398 90 380 90 H180",
		join: "miter",
		width: 44,
		clip: "clip1",
		className: "motion-safe:animate-loader-c3",
	},
	{
		d: "M200 335 V135",
		join: "miter",
		width: 40,
		clip: "clip1",
		className: "motion-safe:animate-loader-c2",
	},
	{
		d: "M269 449.5 V332 C269 312 285 300 305 300 H350 L457 466",
		join: "miter",
		width: 46,
		clip: "clip4",
		className: "motion-safe:animate-loader-b1",
	},
] as const;

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
					{Object.entries(CLIP_PATHS).map(([name, d]) => (
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
							strokeLinejoin={stroke.join as "miter" | "round"}
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
