import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { useAppStore } from "../store";
import { markOnboardingSeen, readOnboardingSeen } from "../store/onboardingStorage";

/** Where worktrees live on disk. Mock (frontend-only) — the real path is host-owned; wired later. */
const MOCK_ROOT = "~/.thinkrail/worktrees";
/** Docs target — the project README on GitHub. */
const DOCS_URL = "https://github.com/JetBrains/thinkrail/blob/main/README.md";
/** How long each feature stays active during the one-time autoplay walkthrough. */
const AUTOPLAY_MS = 5000;

/** The three features shown on screen 2's carousel; selecting one swaps the media placeholder. */
const FEATURES = [
	{ title: "Isolated git worktrees" },
	{ title: "Living spec graph" },
	{ title: "Parallel agent sessions" },
] as const;

const PAGE_KEYS = ["worktrees", "features"] as const;

/** Screen headings use the single Title level (accent); everything else is Body. */
const TITLE = "text-lg font-semibold text-primary leading-tight";
/** The shared "inactive" neutral surface: `--input-bg` at 50% (no darker token exists between it and the
 * card's `--bg-dark`). Used for inactive pagination indicators AND the feature-item fill so they read as
 * one visual system, subtler than the previous solid `--input-bg`. */
const NEUTRAL_SURFACE = "bg-[color-mix(in_srgb,var(--input-bg)_50%,transparent)]";
/** A neutral placeholder standing in for future media (GIFs): a **fixed 4:3** box (never stretched) that
 * anchors the card height, fading into the card background near the bottom so the floating action stays
 * readable. */
const MEDIA =
	"flex aspect-[4/3] w-full items-center justify-center bg-elevated p-lg text-center text-hint text-sm";

/**
 * The two-page indicators — 16×16 rounded squares, **interactive** (the only cross-screen navigation).
 * Left-aligned at the bottom of the text column (the primary action lives under the media, not here).
 */
function Pagination({ page, onSelect }: { page: number; onSelect: (page: number) => void }) {
	return (
		<div data-testid="onboarding-steps" className="flex items-center gap-xs">
			{PAGE_KEYS.map((key, i) => (
				<button
					key={key}
					type="button"
					data-testid={`onboarding-page-${i}`}
					data-active={i === page}
					aria-label={`Go to screen ${i + 1}`}
					onClick={() => onSelect(i)}
					className={`size-4 rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-primary ${
						i === page ? "bg-primary" : NEUTRAL_SURFACE
					}`}
				/>
			))}
		</div>
	);
}

/**
 * First-run onboarding overlay — a card floating over the still-visible IDE (the darkest surface at 80%
 * opacity dims it). Auto-opens once (guarded by the localStorage "seen" flag); re-openable from the
 * left-panel help button in "review" mode. First-run is blocking; review mode is dismissible. Two screens
 * with copy + pagination on the **left** and the media + primary action on the **right**. Screen 2's
 * feature list runs a single autoplay walkthrough (each feature fills like a progress bar for 5s, then
 * stops for good).
 */
export function Onboarding() {
	const mode = useAppStore((s) => s.onboarding);
	const openOnboarding = useAppStore((s) => s.openOnboarding);
	const closeOnboarding = useAppStore((s) => s.closeOnboarding);
	const [page, setPage] = useState(0);
	const [selected, setSelected] = useState(0);
	// Autoplay: `started` guards a single run per visit; `activeAuto` is the index currently filling (or
	// null once autoplay has stopped — naturally or by a manual pick); `maxPlayed` keeps finished items filled.
	const [started, setStarted] = useState(false);
	const [activeAuto, setActiveAuto] = useState<number | null>(null);
	const [maxPlayed, setMaxPlayed] = useState(-1);

	// Auto-open once, ever: only when the durable "seen" flag has not been set.
	useEffect(() => {
		if (!readOnboardingSeen()) openOnboarding("first-run");
	}, [openOnboarding]);

	// Kick off the one-time autoplay the first time screen 2 is shown in this visit.
	useEffect(() => {
		if (page === 1 && !started) {
			setStarted(true);
			setSelected(0);
			setActiveAuto(0);
		}
	}, [page, started]);

	// Advance autoplay: hold each feature for 5s, then step to the next; stop after the last (no loop).
	useEffect(() => {
		if (activeAuto === null) return;
		const timer = setTimeout(() => {
			setMaxPlayed((m) => Math.max(m, activeAuto));
			if (activeAuto < FEATURES.length - 1) {
				setSelected(activeAuto + 1);
				setActiveAuto(activeAuto + 1);
			} else {
				setActiveAuto(null);
			}
		}, AUTOPLAY_MS);
		return () => clearTimeout(timer);
	}, [activeAuto]);

	if (mode === null) return null;
	const firstRun = mode === "first-run";
	const activeFeature = FEATURES[selected] ?? FEATURES[0];

	// A manual pick stops autoplay for good and leaves the carousel in manual mode.
	const selectFeature = (i: number) => {
		setSelected(i);
		setActiveAuto(null);
	};

	const finish = () => {
		if (firstRun) markOnboardingSeen();
		setPage(0);
		setSelected(0);
		setStarted(false);
		setActiveAuto(null);
		setMaxPlayed(-1);
		closeOnboarding();
	};

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				// Review mode closes on any dismiss; first-run is blocking (dismissal is prevented below).
				if (!open && !firstRun) finish();
			}}
		>
			<DialogContent
				data-testid="onboarding"
				hideClose={firstRun}
				overlayClassName="bg-[color-mix(in_srgb,var(--bg-dark)_80%,transparent)]"
				className="!max-w-none !gap-0 !rounded-[var(--radius-lg)] !border-border2 !bg-bg-dark !p-0 w-[calc(100vw-2rem)] overflow-hidden md:w-[calc(100vw-4rem)] lg:w-[55vw]"
				onEscapeKeyDown={(e) => {
					if (firstRun) e.preventDefault();
				}}
				onInteractOutside={(e) => {
					if (firstRun) e.preventDefault();
				}}
			>
				<div className="grid md:grid-cols-3 md:gap-x-[3rem]">
					{/* Text column — left; 32px inset (the 48px column gap supplies the right separation). */}
					<div className="flex flex-col p-[2rem] md:col-span-1 md:pr-0">
						<div className="flex-1">
							{page === 0 ? (
								<>
									<DialogTitle className={TITLE}>Welcome to ThinkRail</DialogTitle>
									<div className="mt-[2rem] flex flex-col gap-md">
										<span className="text-sm text-muted">A spec-first way to build with AI.</span>
										<DialogDescription className="max-w-[72ch] text-sm text-muted">
											ThinkRail works in git-isolated workspaces, keeping your project's intent as a
											connected spec graph that the agent reads, plans, and builds from.
										</DialogDescription>
										<a
											data-testid="onboarding-docs"
											href={DOCS_URL}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-1 self-start text-primary text-sm no-underline outline-none transition-colors hover:text-muted focus-visible:ring-2 focus-visible:ring-primary"
										>
											Learn more in docs
											<ExternalLink className="size-3.5 shrink-0" />
										</a>
									</div>
								</>
							) : (
								<>
									<DialogTitle className={TITLE}>Key features</DialogTitle>
									<ul className="mt-[2rem] flex flex-col gap-[0.5rem]">
										{FEATURES.map((f, i) => {
											const isAuto = activeAuto === i;
											const filled = i <= maxPlayed || (activeAuto === null && i === selected);
											return (
												<li key={f.title}>
													<button
														type="button"
														data-testid={`onboarding-feature-${i}`}
														data-active={i === selected}
														onClick={() => selectFeature(i)}
														className="relative w-full overflow-hidden rounded-[var(--radius-md)] px-[0.75rem] py-[0.5rem] text-left text-sm"
													>
														{isAuto ? (
															<span
																key={`fill-${f.title}`}
																className={`absolute top-0 bottom-0 left-0 animate-fill ${NEUTRAL_SURFACE}`}
															/>
														) : filled ? (
															<span className={`absolute inset-0 ${NEUTRAL_SURFACE}`} />
														) : null}
														<span
															className={`relative ${i === selected ? "text-primary" : "text-text"}`}
														>
															{f.title}
														</span>
													</button>
												</li>
											);
										})}
									</ul>
								</>
							)}
						</div>
						{/* Pagination is fixed: always 96px below the content column, 32px above the card edge. */}
						<div className="pt-24">
							<Pagination page={page} onSelect={setPage} />
						</div>
					</div>

					{/* Media column — right; fills the full card height (top/right/bottom edges), fades into the
					    card background near the bottom, and floats the primary action over that faded area. */}
					<div className="relative self-start md:col-span-2">
						<div data-testid="onboarding-media" className={MEDIA}>
							{page === 0 ? (
								<span className="flex flex-col items-center gap-xs">
									<span className="text-muted">Worktrees are saved in</span>
									<span data-testid="onboarding-root" className="font-[var(--font-mono)] text-text">
										{MOCK_ROOT}
									</span>
								</span>
							) : (
								activeFeature.title
							)}
						</div>
						{/* Bottom fade: transparent → the exact card background (`--bg-dark`), reaching full opacity
						    before the bottom so the button sits on a solid band. No blur, no hard divider. */}
						<div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-[linear-gradient(to_bottom,transparent,var(--bg-dark)_60%)]" />
						<div className="absolute right-[2rem] bottom-[2rem]">
							{page === 0 ? (
								<Button
									className="text-bg"
									data-testid="onboarding-next"
									onClick={() => setPage(1)}
								>
									Confirm path
								</Button>
							) : (
								<Button className="text-bg" data-testid="onboarding-done" onClick={finish}>
									Get started
								</Button>
							)}
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
