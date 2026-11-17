import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { BRAND_MARK_SEGMENTS, BRAND_ORBIT } from "../constants/branding";

const ORBIT_TRANSFORM = `rotate(${BRAND_ORBIT.rotate} ${BRAND_ORBIT.cx} ${BRAND_ORBIT.cy})`;

export function RunningIcon({ className }: { className?: string | undefined }) {
	const t = useT();
	return (
		<span
			data-testid="running-icon"
			data-running="true"
			data-neon="pulse"
			role="img"
			aria-label={t("components.runningIcon.label")}
			className={cn("inline-flex shrink-0 items-center justify-center", className)}
		>
			<svg aria-hidden="true" viewBox="0 0 100 100" className="size-full">
				<ellipse
					cx={BRAND_ORBIT.cx}
					cy={BRAND_ORBIT.cy}
					rx={BRAND_ORBIT.rx}
					ry={BRAND_ORBIT.ry}
					transform={ORBIT_TRANSFORM}
					fill="none"
					stroke="currentColor"
					strokeWidth={BRAND_ORBIT.width}
					strokeOpacity="0.35"
				/>
				<ellipse
					data-testid="running-icon-frame"
					cx={BRAND_ORBIT.cx}
					cy={BRAND_ORBIT.cy}
					rx={BRAND_ORBIT.rx}
					ry={BRAND_ORBIT.ry}
					transform={ORBIT_TRANSFORM}
					fill="none"
					stroke="currentColor"
					strokeWidth={BRAND_ORBIT.width}
					strokeLinecap="round"
					strokeDasharray="280 720"
					pathLength="1000"
					className="motion-safe:animate-helios-orbit"
				/>
				<path
					d={BRAND_MARK_SEGMENTS.sun}
					fill="currentColor"
					className="motion-safe:animate-helios-sun"
				/>
			</svg>
		</span>
	);
}
