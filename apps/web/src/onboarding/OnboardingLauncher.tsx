import { GraduationCap } from "lucide-react";
import { useAppStore } from "../store";

export function OnboardingLauncher() {
	const startDemoTour = useAppStore((s) => s.startDemoTour);
	return (
		<button
			type="button"
			data-testid="onboarding-launch"
			aria-label="Start the onboarding demo"
			title="Start the onboarding demo"
			onClick={() => startDemoTour()}
			className="flex h-7 items-center gap-sm rounded-[var(--radius-sm)] px-sm text-text-muted tr-text-ui outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
		>
			<GraduationCap className="size-4 shrink-0" />
			<span className="truncate">Onboarding demo</span>
		</button>
	);
}
