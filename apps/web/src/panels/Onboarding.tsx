import { HelpCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppStore } from "../store";
import { markOnboardingSeen, readOnboardingSeen } from "../store/onboardingStorage";

// MOCK default worktree root shown on the approval step (no host lookup; see task-onboarding-flow).
const MOCK_ROOT = "~/.thinkrail/worktrees";

/** An inline help control placed right after the word "worktree": the app's question-mark icon
 * (`HelpCircle`) opening a small popover that explains the concept. Inline so it wraps with the
 * paragraph; no docs route exists, so it shows the explanation inline only (no "Learn more"). */
function WorktreeHelp() {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-testid="worktree-help"
					aria-label="What is a git worktree?"
					className="mx-0.5 inline-flex align-middle text-hint outline-none hover:text-text focus-visible:text-text"
				>
					<HelpCircle className="size-3.5" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="max-w-[20rem] px-md py-sm text-muted text-sm">
				Each workspace is a git worktree — its own branch and its own directory on disk, isolated
				from the main project and from other workspaces.
			</PopoverContent>
		</Popover>
	);
}

/** Render the welcome paragraph with the worktree help control inserted right after the word
 * "worktree" (copy unchanged; only step 0 uses this). */
function WelcomeBody({ text }: { text: string }) {
	const marker = "worktree";
	const at = text.indexOf(marker);
	if (at < 0) return <>{text}</>;
	const end = at + marker.length;
	return (
		<>
			{text.slice(0, end)}
			<WorktreeHelp />
			{text.slice(end)}
		</>
	);
}

/** The onboarding steps. Step 0 is the combined Welcome + root-approval; the rest are feature explainers. */
const STEPS: { title: string; body: string }[] = [
	{
		title: "ThinkRail",
		body: "A spec-first way to build with AI. ThinkRail keeps your project's intent as a connected spec graph that the agent reads, plans, and builds from, all in git worktree isolated workspaces.",
	},
	{
		title: "Isolated git worktrees",
		body: "Every workspace is a git worktree — its own branch and its own directory — so parallel work never collides and your main branch stays clean.",
	},
	{
		title: "A living spec graph",
		body: "Your project's intent lives as a connected spec graph. The agent reads it to plan and build, and it stays the source of truth as the code lands.",
	},
	{
		title: "Parallel agent sessions",
		body: "Run several agents at once — each in its own workspace, streaming independently — and switch between them instantly.",
	},
];

/**
 * The first-run onboarding overlay (full-viewport, sequential, step-indicated), re-openable from the
 * logo. First launch (`readOnboardingSeen()` false) auto-opens it **blocking** — no close/skip, the
 * user must step through and approve the root path. The logo re-opens it in **review** mode, which is
 * closable. Mock data only (root path + the seen flag); frontend-only.
 */
export function Onboarding() {
	const mode = useAppStore((s) => s.onboarding);
	const openOnboarding = useAppStore((s) => s.openOnboarding);
	const closeOnboarding = useAppStore((s) => s.closeOnboarding);

	// First launch → auto-open the blocking flow. `openOnboarding` is a stable store action, so this
	// effectively runs once (readOnboardingSeen is a localStorage read, not reactive).
	useEffect(() => {
		if (!readOnboardingSeen()) openOnboarding("first-run");
	}, [openOnboarding]);

	const [step, setStep] = useState(0);

	const current = STEPS[step];
	if (!mode || !current) return null;
	const firstRun = mode === "first-run";
	const isLast = step === STEPS.length - 1;

	const finish = () => {
		if (firstRun) markOnboardingSeen();
		setStep(0);
		closeOnboarding();
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				// Review is closable; first-run can only be left via "Get started" (finish).
				if (!open && !firstRun) finish();
			}}
		>
			<DialogContent
				data-testid="onboarding"
				hideClose={firstRun}
				onEscapeKeyDown={(e) => firstRun && e.preventDefault()}
				onInteractOutside={(e) => firstRun && e.preventDefault()}
				className="!inset-0 !max-w-none !translate-x-0 !translate-y-0 !gap-0 !rounded-none !border-0 !p-0 flex overflow-y-auto"
			>
				{/* One left-aligned block, ~60% of the viewport (wider on mobile), centered by position alone —
				    no border/card/panel. Indicator top-left, then flush-left title/description/fields, and the
				    primary action at the block's bottom-right (shared bounds). Block-flow so paragraphs wrap. */}
				<div className="m-auto flex w-full max-w-[90%] flex-col gap-lg px-lg py-xl md:max-w-[60%]">
					{/* Step indicator at the top of the block (left-aligned). */}
					<div className="flex flex-col items-start gap-sm">
						<div data-testid="onboarding-steps" className="flex items-center gap-xs">
							{STEPS.map((s, idx) => (
								<span
									key={s.title}
									className={`size-1.5 rounded-full ${idx === step ? "bg-primary" : "bg-border2"}`}
								/>
							))}
						</div>
						<span className="text-hint text-xs">
							Step {step + 1} of {STEPS.length}
						</span>
					</div>

					{/* Left-aligned title + description. */}
					<div className="flex flex-col gap-md">
						<DialogTitle className="text-[length:var(--font-xl)]">{current.title}</DialogTitle>
						<DialogDescription className="text-md">
							{step === 0 ? <WelcomeBody text={current.body} /> : current.body}
						</DialogDescription>
					</div>

					{step === 0 ? (
						<div className="flex flex-col gap-xs text-left">
							<span className="text-muted text-xs uppercase tracking-wider">
								Worktrees are saved in
							</span>
							<div
								data-testid="onboarding-root"
								className="rounded-[var(--radius-sm)] border border-border2 bg-[var(--input-bg)] px-sm py-xs font-[var(--font-mono)] text-sm text-text"
							>
								{MOCK_ROOT}
							</div>
							<span className="text-hint text-xs">
								Do not move or delete the worktrees subdirectories. Instead, archive worktrees in
								ThinkRail.
							</span>
						</div>
					) : null}

					{/* Primary action at the block's bottom-right (Back stays left). */}
					<div className="flex items-center justify-between gap-md">
						{step > 0 ? (
							<Button
								variant="outline"
								data-testid="onboarding-back"
								onClick={() => setStep((i) => i - 1)}
							>
								Back
							</Button>
						) : (
							<span />
						)}
						{isLast ? (
							<Button data-testid="onboarding-done" onClick={finish}>
								Get started
							</Button>
						) : (
							<Button data-testid="onboarding-next" onClick={() => setStep((i) => i + 1)}>
								Continue
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
