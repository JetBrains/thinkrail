import { cn } from "@thinkrail/ui/utils";
import { useId } from "react";
import { BRAND_MARK_PATH, BRAND_MARK_SIZE } from "../constants/branding";

const MARK_SCALE = 22.5 / Math.hypot(BRAND_MARK_SIZE.width / 2, BRAND_MARK_SIZE.height / 2);
const MARK_X = (32 - (BRAND_MARK_SIZE.width / 2) * MARK_SCALE).toFixed(3);
const MARK_Y = (32 - (BRAND_MARK_SIZE.height / 2) * MARK_SCALE).toFixed(3);
const MARK_TRANSFORM = `translate(${MARK_X} ${MARK_Y}) scale(${MARK_SCALE.toFixed(5)})`;

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
			<svg aria-hidden="true" viewBox="0 0 64 64" className="size-full">
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
					className="motion-safe:animate-working-pulse"
				/>
				<g
					data-testid="running-icon-train"
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
				<path
					d={BRAND_MARK_PATH}
					pathLength="1000"
					fill="none"
					stroke="currentColor"
					strokeWidth="36"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeDasharray="90 243.33"
					transform={MARK_TRANSFORM}
					className="motion-safe:animate-working-trace motion-reduce:hidden"
				/>
			</svg>
		</span>
	);
}
