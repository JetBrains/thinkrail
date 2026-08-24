import { useShallow } from "zustand/react/shallow";
import { Button } from "../components/ui/button";
import { useAppStore } from "../store";
import { type CoachStep, selectCoach } from "./coach";
import { resetDemo } from "./demo";
import { CoachBody, Spotlight } from "./Spotlight";

export function OnboardingCoach() {
	const coach = useAppStore(useShallow(selectCoach));
	if (!coach) return null;
	if (coach.done) return <DoneCard />;
	return <StepSpotlight coach={coach} />;
}

function StepSpotlight({ coach }: { coach: CoachStep }) {
	const setChatDraft = useAppStore((s) => s.setChatDraft);
	return (
		<Spotlight selector={coach.selector}>
			<CoachBody
				step={coach.index}
				title={coach.title}
				body={coach.body}
				action={
					coach.insertPrompt && coach.sessionId ? (
						<Button
							variant="outline"
							size="sm"
							data-testid="onboarding-insert-prompt"
							onClick={() => setChatDraft(coach.sessionId as string, coach.insertPrompt as string)}
						>
							Insert prompt
						</Button>
					) : undefined
				}
			/>
		</Spotlight>
	);
}

function DoneCard() {
	const resetOnboarding = useAppStore((s) => s.resetOnboarding);
	return (
		<div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center pb-xl">
			<div
				data-testid="onboarding-coach"
				className="pointer-events-auto w-[320px] rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-lg text-center shadow-[var(--shadow-md)]"
			>
				<p className="tr-title-card text-text-default">You're all set</p>
				<p className="mt-xs text-text-muted tr-text-metadata leading-snug">
					You created two isolated workspaces and ran agents in parallel — that's the ThinkRail
					loop.
				</p>
				<div className="mt-md flex items-center justify-center gap-sm">
					<Button
						variant="outline"
						size="sm"
						data-testid="onboarding-reset"
						onClick={() => void resetDemo()}
					>
						Reset demo
					</Button>
					<Button size="sm" data-testid="onboarding-done" onClick={() => resetOnboarding()}>
						Done
					</Button>
				</div>
			</div>
		</div>
	);
}
