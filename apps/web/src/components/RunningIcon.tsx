import { useId } from "react";
import { BRAND_MARK_PATH, BRAND_MARK_SIZE } from "../constants/branding";
import { cn } from "@/lib";

const MARK_SCALE = 22.5 / Math.hypot(BRAND_MARK_SIZE.width / 2, BRAND_MARK_SIZE.height / 2);
const MARK_TRANSFORM = `translate(${(32 - (BRAND_MARK_SIZE.width / 2) * MARK_SCALE).toFixed(3)} ${(
	32 -
	(BRAND_MARK_SIZE.height / 2) * MARK_SCALE
).toFixed(3)}) scale(${MARK_SCALE.toFixed(5)})`;

const RAILS = [
	"M20 20H290",
	"M360 20H400A80 80 0 0 1 480 100V195C480 235 460 270 430 286L519 431",
	"M20 90H130V429",
	"M200 90V429",
	"M200 90H410V228H300C250 228 215 262 200 300",
	"M269 429V310Q269 300 280 300H345Q352 300 356 307L434 431",
] as const;

const SIGNAL_DELAYS = [
	"",
	"[--signal-delay:-1.125s]",
	"[--signal-delay:-2.25s]",
	"[--signal-delay:-3.375s]",
	"[--signal-delay:-4.5s]",
	"[--signal-delay:-5.625s]",
] as const;

export function RunningIcon({ className }: { className?: string | undefined }) {
	const tailGradient = useId();
	return (
		<span
			data-testid="running-icon"
			data-running="true"
			role="img"
			aria-label="Agent working"
			className={cn("inline-flex shrink-0 items-center justify-center", className)}
		>
			<svg aria-hidden viewBox="0 0 64 64" className="size-full">
				<defs>
					<linearGradient
						id={tailGradient}
						gradientUnits="userSpaceOnUse"
						x1="32"
						y1="4"
						x2="10.426"
						y2="14.152"
					>
						<stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
						<stop offset="1" stopColor="currentColor" stopOpacity="0" />
					</linearGradient>
				</defs>
				<circle
					cx="32"
					cy="32"
					r="28"
					fill="none"
					stroke="currentColor"
					strokeWidth="4"
					className="motion-safe:opacity-30"
				/>
				<path
					d={BRAND_MARK_PATH}
					fill="currentColor"
					transform={MARK_TRANSFORM}
					className="motion-safe:opacity-40"
				/>
				<g
					data-part="train"
					className="origin-[32px_32px] [transform-box:view-box] motion-safe:animate-working-train motion-reduce:hidden"
				>
					<circle
						cx="32"
						cy="32"
						r="28"
						fill="none"
						stroke={`url(#${tailGradient})`}
						strokeWidth="4"
						pathLength="100"
						strokeDasharray="14 86"
						transform="rotate(-140.4 32 32)"
					/>
					<circle cx="32" cy="4" r="3.8" fill="currentColor" />
				</g>
				<g
					fill="none"
					stroke="currentColor"
					strokeWidth="40"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeDasharray="28 200"
					transform={MARK_TRANSFORM}
					className="motion-reduce:hidden"
				>
					{RAILS.map((d, rail) => (
						<path
							key={d}
							d={d}
							pathLength="100"
							className={cn("motion-safe:animate-working-signal", SIGNAL_DELAYS[rail])}
						/>
					))}
				</g>
			</svg>
		</span>
	);
}
