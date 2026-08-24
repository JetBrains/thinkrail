import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover";
import { useAppStore } from "../store";
import { type CoachStep, selectCoach } from "./coach";
import { resetDemo } from "./demo";

export function OnboardingCoach() {
	const coach = useAppStore(useShallow(selectCoach));
	if (!coach) return null;
	if (coach.done) return <DonePopover />;
	return <StepPopover coach={coach} />;
}

function useTargetRect(selector: string): DOMRect | null {
	const [rect, setRect] = useState<DOMRect | null>(null);
	useEffect(() => {
		let frame = 0;
		const measure = () => {
			const element = document.querySelector(selector);
			setRect(element ? element.getBoundingClientRect() : null);
			frame = requestAnimationFrame(measure);
		};
		measure();
		return () => cancelAnimationFrame(frame);
	}, [selector]);
	return rect;
}

function StepPopover({ coach }: { coach: CoachStep }) {
	const rect = useTargetRect(coach.selector);
	const dismiss = useAppStore((s) => s.dismissOnboarding);
	const setChatDraft = useAppStore((s) => s.setChatDraft);
	if (!rect) return null;

	return (
		<Popover open>
			<PopoverAnchor asChild>
				<div
					aria-hidden
					className="pointer-events-none fixed z-40 rounded-[var(--radius-sm)] border-2 border-primary-muted"
					style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
				/>
			</PopoverAnchor>
			<PopoverContent
				data-testid="onboarding-coach"
				align="start"
				side="bottom"
				className="w-[280px] p-md"
			>
				<p className="tr-text-label-pill text-primary">Step {coach.index} of 3</p>
				<p className="mt-xs tr-title-card text-text-default">{coach.title}</p>
				<p className="mt-xs text-text-muted tr-text-metadata leading-snug">{coach.body}</p>
				<div className="mt-md flex items-center justify-between gap-sm">
					<Button variant="ghost" size="sm" data-testid="onboarding-skip" onClick={() => dismiss()}>
						Skip tour
					</Button>
					{coach.insertPrompt && coach.sessionId ? (
						<Button
							variant="outline"
							size="sm"
							data-testid="onboarding-insert-prompt"
							onClick={() => setChatDraft(coach.sessionId as string, coach.insertPrompt as string)}
						>
							Insert prompt
						</Button>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function DonePopover() {
	const dismiss = useAppStore((s) => s.dismissOnboarding);
	return (
		<div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center pb-xl">
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
					<Button size="sm" data-testid="onboarding-done" onClick={() => dismiss()}>
						Done
					</Button>
				</div>
			</div>
		</div>
	);
}
